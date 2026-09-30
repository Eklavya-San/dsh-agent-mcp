import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { snapshotGit, diffWorkerChanges, findGitRepositories, ensureLocalGitExclude } from "./git.js";
import { resolvePiBinary } from "./pi-bin.js";
import { resolveProvider } from "./providers.js";
import type { DshTaskOptions, DshTaskResult, PiTaskOptions, PiTaskResult } from "./types.js";
import { emitTaskEvent } from "./web.js";

export interface ActiveTaskRecord {
  child: ChildProcess;
  cwd: string;
  task: string;
  startTime: number;
}

const activeTasks = new Map<string, ActiveTaskRecord>();

export function registerActiveTask(taskId: string, record: ActiveTaskRecord): void {
  activeTasks.set(taskId, record);
}

export function unregisterActiveTask(taskId: string): void {
  activeTasks.delete(taskId);
}

export function listActiveTasks(): Array<{ taskId: string; cwd: string; task: string; runningSec: number }> {
  const now = Date.now();
  const list: Array<{ taskId: string; cwd: string; task: string; runningSec: number }> = [];
  for (const [taskId, record] of activeTasks.entries()) {
    list.push({
      taskId,
      cwd: record.cwd,
      task: record.task,
      runningSec: Math.floor((now - record.startTime) / 1000),
    });
  }
  return list;
}

export function cancelPiTask(taskId: string): boolean {
  const record = activeTasks.get(taskId);
  if (!record) return false;

  try {
    record.child.kill("SIGTERM");
    setTimeout(() => {
      try {
        if (!record.child.killed) record.child.kill("SIGKILL");
      } catch {}
    }, 1000);
    activeTasks.delete(taskId);
    emitTaskEvent({
      type: "task_cancelled",
      taskId,
    });
    return true;
  } catch {
    activeTasks.delete(taskId);
    return false;
  }
}

// Backward compatibility alias for src/mcp.ts until Task 6 rewires it
export const cancelDshTask = cancelPiTask;

export function buildPiRunnerEnv(options: PiTaskOptions & { endpoint?: string; apiKey?: string }): NodeJS.ProcessEnv {
  const providerConfig = resolveProvider(options.provider);
  const baseUrl = options.endpoint || providerConfig.baseUrl;
  const apiKey = options.apiKey || providerConfig.apiKey;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENAI_BASE_URL: baseUrl,
  };

  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
  }

  if (providerConfig.id === "nvidia-nim" && apiKey) {
    env.NVIDIA_API_KEY = apiKey;
  } else if (providerConfig.id === "openrouter" && apiKey) {
    env.OPENROUTER_API_KEY = apiKey;
  } else if (providerConfig.id === "freetoken") {
    env.FREETOKEN_BASE_URL = baseUrl;
    if (apiKey) env.FREETOKEN_API_KEY = apiKey;
  }

  return env;
}

export const buildRunnerEnv = buildPiRunnerEnv;

export async function runPiTask(options: PiTaskOptions): Promise<PiTaskResult> {
  const { cwd, task, timeoutMs = 1800000, verbose = false } = options; // Default 30 min
  const startTime = Date.now();
  const taskId = `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const liveFilePath = join(cwd, ".pi-live.md");

  const providerConfig = resolveProvider(options.provider);
  const effectiveModel = options.model
    ? (options.provider && !options.model.includes("/")
        ? `${providerConfig.id}/${options.model}`
        : options.model)
    : `${providerConfig.id}/${providerConfig.defaultModel}`;

  const childEnv = buildPiRunnerEnv(options);

  // Ensure .pi-live.md is excluded locally from git tracking in all workspace repos
  const repos = findGitRepositories(cwd);
  for (const repo of repos) {
    ensureLocalGitExclude(repo, ".pi-live.md");
  }

  // 1. Snapshot git before starting
  const beforeSnapshot = snapshotGit(cwd);

  return new Promise<PiTaskResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let lastWriteTime = 0;
    let writePending = false;

    // Helper to format and write .pi-live.md for live progress inspection
    const updateLiveFile = (isFinal = false, exitCode: number | null = null) => {
      try {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusIcon = isFinal
          ? exitCode === 0
            ? "🟢 COMPLETED"
            : "🔴 FAILED"
          : "🟡 RUNNING...";

        let content = `# ⚡ Pi Agent Live Activity\n\n`;
        content += `> **Status**: ${statusIcon} (${elapsedSec}s elapsed)\n`;
        content += `> **Model**: ${effectiveModel} • **Provider**: ${providerConfig.name}\n`;
        content += `> **Task**: ${task}\n`;
        content += `> **Workspace**: \`${cwd}\`\n\n`;
        content += `---\n\n`;

        content += `### 📝 Assistant Output Stream\n\n`;
        if (stdout.trim().length > 0) {
          content += `${stdout.trim()}\n\n`;
        } else {
          content += `*Waiting for response generation...*\n\n`;
        }

        if (isFinal) {
          const { filesChanged, diffSummary } = diffWorkerChanges(cwd, beforeSnapshot);
          content += `---\n\n### 📁 Files Modified\n\n`;
          if (filesChanged.length > 0) {
            content += filesChanged.map((f) => `- \`${f}\``).join("\n") + "\n\n";
          } else {
            content += `*No files modified.*\n\n`;
          }
          content += `### 📊 Git Changes\n\n\`\`\`\n${diffSummary}\n\`\`\`\n`;
        }

        writeFileSync(liveFilePath, content, "utf-8");
      } catch {}
    };

    updateLiveFile(false);

    const scheduleLiveUpdate = () => {
      const now = Date.now();
      if (now - lastWriteTime > 250) {
        lastWriteTime = now;
        updateLiveFile(false);
      } else if (!writePending) {
        writePending = true;
        setTimeout(() => {
          writePending = false;
          lastWriteTime = Date.now();
          updateLiveFile(false);
        }, 250);
      }
    };

    const piBin = resolvePiBinary() || "pi";
    const spawnArgs = ["--print", "--no-session", "--model", effectiveModel, task];

    const child = spawn(piBin, spawnArgs, {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    registerActiveTask(taskId, {
      child,
      cwd,
      task,
      startTime,
    });

    emitTaskEvent({
      type: "task_started",
      taskId,
      cwd,
      task,
      model: effectiveModel,
      startTime,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const delta = chunk.toString("utf-8");
      stdout += delta;
      scheduleLiveUpdate();
      emitTaskEvent({
        type: "log_delta",
        taskId,
        delta,
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const delta = chunk.toString("utf-8");
      stderr += delta;
      scheduleLiveUpdate();
      emitTaskEvent({
        type: "log_delta",
        taskId,
        delta,
      });
    });

    let settled = false;

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime;

      updateLiveFile(true, code);

      const { filesChanged, diffSummary, rawDiff } = diffWorkerChanges(cwd, beforeSnapshot);

      const status: "SUCCESS" | "FAILED" | "TIMED_OUT" = timedOut
        ? "TIMED_OUT"
        : code === 0
        ? "SUCCESS"
        : "FAILED";

      const error = code !== 0 ? (stderr.trim() || `Process exited with code ${code}`) : undefined;

      emitTaskEvent({
        type: "task_finished",
        taskId,
        status,
        durationMs,
        filesChanged,
      });

      resolve({
        status,
        taskId,
        cwd,
        task,
        durationMs,
        filesChanged,
        diffSummary,
        rawDiff,
        output: stdout.trim(),
        error,
      });
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime;

      updateLiveFile(true, -1);

      const { filesChanged, diffSummary, rawDiff } = diffWorkerChanges(cwd, beforeSnapshot);

      emitTaskEvent({
        type: "task_finished",
        taskId,
        status: "FAILED",
        durationMs,
        filesChanged,
      });

      resolve({
        status: "FAILED",
        taskId,
        cwd,
        task,
        durationMs,
        filesChanged,
        diffSummary,
        rawDiff,
        output: stdout.trim(),
        error: `Failed to spawn Pi process ('${piBin}'): ${err.message}`,
      });
    });
  });
}

// Backward compatibility wrapper for src/mcp.ts until Task 6 rewires it
export async function runDshTask(options: DshTaskOptions): Promise<DshTaskResult & PiTaskResult> {
  const piResult = await runPiTask({
    cwd: options.cwd,
    task: options.task,
    model: options.model,
    timeoutMs: options.timeoutMs,
    verbose: options.verbose,
  });

  return {
    ...piResult,
    summary: piResult.output || (piResult.status === "SUCCESS" ? "Task completed successfully." : "Task failed."),
    reasoning: "",
    gitDiffSummary: piResult.diffSummary,
    exitCode: piResult.status === "SUCCESS" ? 0 : 1,
    rawOutput: options.verbose ? piResult.output : undefined,
  };
}
