import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join, relative } from "path";
import { snapshotGit, diffWorkerChanges, findGitRepositories, findGitRoot, ensureLocalGitExclude } from "./git.js";
import { cleanupTaskWorktree, createTaskWorktree, type WorktreeInfo } from "./worktree.js";
import { resolvePiBinary } from "./pi-bin.js";
import { resolveProvider } from "./providers.js";
import type { DshTaskOptions, DshTaskResult, PiTaskOptions, PiTaskResult } from "./types.js";
import { emitTaskEvent } from "./web.js";

export interface ActiveTaskRecord {
  child: ChildProcess;
  cwd: string;
  task: string;
  startTime: number;
  worktree?: WorktreeInfo;
}

const activeTasks = new Map<string, ActiveTaskRecord>();

export function registerActiveTask(taskId: string, record: ActiveTaskRecord): void { activeTasks.set(taskId, record); }
export function unregisterActiveTask(taskId: string): void { activeTasks.delete(taskId); }

export function listActiveTasks(): Array<{ taskId: string; cwd: string; task: string; runningSec: number }> {
  const now = Date.now();
  return [...activeTasks.entries()].map(([taskId, record]) => ({
    taskId, cwd: record.cwd, task: record.task,
    runningSec: Math.floor((now - record.startTime) / 1000),
  }));
}

export function cancelPiTask(taskId: string): boolean {
  const record = activeTasks.get(taskId);
  if (!record) return false;
  try {
    record.child.kill("SIGTERM");
    setTimeout(() => { try { if (!record.child.killed) record.child.kill("SIGKILL"); } catch {} }, 1000);
    // Keep the failed/cancelled worktree available for inspection.
    activeTasks.delete(taskId);
    emitTaskEvent({ type: "task_cancelled", taskId });
    return true;
  } catch {
    activeTasks.delete(taskId);
    return false;
  }
}

export const cancelDshTask = cancelPiTask;

export function buildPiRunnerEnv(options: PiTaskOptions & { endpoint?: string; apiKey?: string }): NodeJS.ProcessEnv {
  const providerConfig = resolveProvider(options.provider);
  const baseUrl = options.endpoint || providerConfig.baseUrl;
  const apiKey = options.apiKey || providerConfig.apiKey;
  const env: NodeJS.ProcessEnv = { ...process.env, OPENAI_BASE_URL: baseUrl };
  if (apiKey) env.OPENAI_API_KEY = apiKey;
  if (providerConfig.id === "nvidia-nim" && apiKey) env.NVIDIA_API_KEY = apiKey;
  else if (providerConfig.id === "openrouter" && apiKey) env.OPENROUTER_API_KEY = apiKey;
  else if (providerConfig.id === "freetoken") {
    env.FREETOKEN_BASE_URL = baseUrl;
    if (apiKey) env.FREETOKEN_API_KEY = apiKey;
  }
  return env;
}

export const buildRunnerEnv = buildPiRunnerEnv;

export async function runPiTask(options: PiTaskOptions): Promise<PiTaskResult> {
  const { cwd, task, timeoutMs = 1800000 } = options;
  const startTime = Date.now();
  const taskId = `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const providerConfig = resolveProvider(options.provider);
  const effectiveModel = options.model
    ? (options.provider && !options.model.includes("/") ? `${providerConfig.id}/${options.model}` : options.model)
    : `${providerConfig.id}/${providerConfig.defaultModel}`;
  const childEnv = buildPiRunnerEnv(options);

  const repositoryRoot = findGitRoot(cwd);
  let worktree: WorktreeInfo | undefined;
  let agentCwd = cwd;
  if (repositoryRoot) {
    // A task gets a detached worktree rooted at the current HEAD. The user's
    // primary working tree is never used as the agent's process cwd.
    worktree = createTaskWorktree(repositoryRoot, taskId);
    const cwdRelativeToRoot = relative(repositoryRoot, cwd);
    agentCwd = cwdRelativeToRoot ? join(worktree.path, cwdRelativeToRoot) : worktree.path;
  }

  const repos = findGitRepositories(agentCwd);
  for (const repo of repos) ensureLocalGitExclude(repo, ".pi-live.md");
  const beforeSnapshot = snapshotGit(agentCwd);
  const liveFilePath = join(agentCwd, ".pi-live.md");

  return new Promise<PiTaskResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let lastWriteTime = 0;
    let writePending = false;
    let settled = false;

    const updateLiveFile = (isFinal = false, exitCode: number | null = null) => {
      try {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusIcon = isFinal ? (exitCode === 0 ? "COMPLETED" : "FAILED") : "RUNNING...";
        let content = `# Pi Agent Live Activity\n\n`;
        content += `> **Status**: ${statusIcon} (${elapsedSec}s elapsed)\n`;
        content += `> **Model**: ${effectiveModel} • **Provider**: ${providerConfig.name}\n`;
        content += `> **Task**: ${task}\n`;
        content += `> **Workspace**: \`${agentCwd}\`\n\n---\n\n`;
        content += `### Assistant Output Stream\n\n${stdout.trim() || "*Waiting for response generation...*"}\n\n`;
        if (isFinal) {
          const { filesChanged, diffSummary } = diffWorkerChanges(agentCwd, beforeSnapshot);
          content += `---\n\n### Files Modified\n\n${filesChanged.length ? filesChanged.map(f => `- \`${f}\``).join("\n") : "*No files modified.*"}\n\n`;
          content += `### Git Changes\n\n\`\`\`\n${diffSummary}\n\`\`\`\n`;
        }
        writeFileSync(liveFilePath, content, "utf-8");
      } catch {}
    };

    const scheduleLiveUpdate = () => {
      const now = Date.now();
      if (now - lastWriteTime > 250) {
        lastWriteTime = now;
        updateLiveFile(false);
      } else if (!writePending) {
        writePending = true;
        setTimeout(() => { writePending = false; lastWriteTime = Date.now(); updateLiveFile(false); }, 250);
      }
    };

    const finish = (status: "SUCCESS" | "FAILED" | "TIMED_OUT", code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime;
      const { filesChanged, diffSummary, rawDiff } = diffWorkerChanges(agentCwd, beforeSnapshot);
      updateLiveFile(true, code);
      emitTaskEvent({ type: "task_finished", taskId, status, durationMs, filesChanged });
      // Successful tasks are cleaned up only after their diff has been captured.
      // Failed/timed-out tasks keep their worktree so the caller can inspect it.
      if (worktree) {
        try { cleanupTaskWorktree(worktree, status !== "SUCCESS"); } catch {}
      }
      resolve({ status, taskId, cwd, task, durationMs, filesChanged, diffSummary, rawDiff, output: stdout.trim(), error });
    };

    try {
      updateLiveFile(false);
      const piBin = resolvePiBinary() || "pi";
      const child = spawn(piBin, ["--print", "--no-session", "--model", effectiveModel, task], {
        cwd: agentCwd,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      registerActiveTask(taskId, { child, cwd: agentCwd, task, startTime, worktree });
      emitTaskEvent({ type: "task_started", taskId, cwd: agentCwd, task, model: effectiveModel, startTime });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
          setTimeout(() => { try { if (!child.killed) child.kill("SIGKILL"); } catch {} }, 3000);
        } catch {}
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        const delta = chunk.toString("utf-8"); stdout += delta; scheduleLiveUpdate();
        emitTaskEvent({ type: "log_delta", taskId, delta });
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const delta = chunk.toString("utf-8"); stderr += delta; scheduleLiveUpdate();
        emitTaskEvent({ type: "log_delta", taskId, delta });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const status = timedOut ? "TIMED_OUT" : code === 0 ? "SUCCESS" : "FAILED";
        finish(status, code, code !== 0 ? (stderr.trim() || `Process exited with code ${code}`) : undefined);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        finish("FAILED", -1, `Failed to spawn Pi process ('${piBin}'): ${err.message}`);
      });
    } catch (error) {
      finish("FAILED", -1, error instanceof Error ? error.message : String(error));
    }
  });
}

export async function runDshTask(options: DshTaskOptions): Promise<DshTaskResult & PiTaskResult> {
  const piResult = await runPiTask({ cwd: options.cwd, task: options.task, model: options.model, timeoutMs: options.timeoutMs, verbose: options.verbose });
  return {
    ...piResult,
    summary: piResult.output || (piResult.status === "SUCCESS" ? "Task completed successfully." : "Task failed."),
    reasoning: "",
    gitDiffSummary: piResult.diffSummary,
    exitCode: piResult.status === "SUCCESS" ? 0 : 1,
    rawOutput: options.verbose ? piResult.output : undefined,
  };
}
