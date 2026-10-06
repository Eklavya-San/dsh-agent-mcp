import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { snapshotGit, diffWorkerChanges, findGitRepositories, findGitRoot, ensureLocalGitExclude } from "./git.js";
import { cleanupTaskWorktree, createTaskWorktree, type WorktreeInfo } from "./worktree.js";
import { resolvePiBinary } from "./pi-bin.js";
import { resolveProvider } from "./providers.js";
import { upsertTask, recoverInterruptedTasks } from "./task-store.js";
import { runVerificationPipeline } from "./verify.js";
import type { DshTaskOptions, DshTaskResult, PiTaskOptions, PiTaskResult } from "./types.js";
import { emitTaskEvent } from "./web.js";

export interface ActiveTaskRecord { child: ChildProcess; cwd: string; task: string; startTime: number; worktree?: WorktreeInfo; }
const activeTasks = new Map<string, ActiveTaskRecord>();
let recovered = false;

function ensureRecovered(): void { if (!recovered) { recoverInterruptedTasks(); recovered = true; } }
export function registerActiveTask(taskId: string, record: ActiveTaskRecord): void { activeTasks.set(taskId, record); }
export function unregisterActiveTask(taskId: string): void { activeTasks.delete(taskId); }
export function listActiveTasks(): Array<{ taskId: string; cwd: string; task: string; runningSec: number }> {
  ensureRecovered(); const now = Date.now();
  return [...activeTasks.entries()].map(([taskId, record]) => ({ taskId, cwd: record.cwd, task: record.task, runningSec: Math.floor((now - record.startTime) / 1000) }));
}

export function cancelPiTask(taskId: string): boolean {
  const record = activeTasks.get(taskId); if (!record) return false;
  try {
    record.child.kill("SIGTERM");
    setTimeout(() => { try { if (!record.child.killed) record.child.kill("SIGKILL"); } catch {} }, 1000);
    activeTasks.delete(taskId);
    upsertTask({ id: taskId, status: "CANCELLED", task: record.task, cwd: record.cwd, worktree: record.worktree?.path, createdAt: record.startTime, startedAt: record.startTime, finishedAt: Date.now(), retryCount: 0, changedFiles: [] });
    emitTaskEvent({ type: "task_cancelled", taskId });
    return true;
  } catch { activeTasks.delete(taskId); return false; }
}
export const cancelDshTask = cancelPiTask;

function validateWorkspace(cwd: string): string {
  const resolved = resolve(cwd);
  if (!isAbsolute(cwd)) throw new Error("Workspace path must be absolute");
  const configured = (process.env.PI_WORKSPACE_ROOTS || "").split(",").map((v) => v.trim()).filter(Boolean).map(resolve);
  if (configured.length && !configured.some((root) => resolved === root || relative(root, resolved) && !relative(root, resolved).startsWith("..") && !isAbsolute(relative(root, resolved)))) {
    throw new Error(`Workspace is outside the configured allowlist: ${resolved}`);
  }
  return resolved;
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const blocked = /^(AWS_|AZURE_|GCP_|GOOGLE_|GITHUB_TOKEN$|GH_TOKEN$|NPM_TOKEN$|DATABASE_URL$|MONGODB_URI$|.*_PASSWORD$|.*_SECRET$)$/i;
  for (const key of Object.keys(env)) if (blocked.test(key)) delete env[key];
  return env;
}

export function buildPiRunnerEnv(options: PiTaskOptions & { endpoint?: string; apiKey?: string }): NodeJS.ProcessEnv {
  const providerConfig = resolveProvider(options.provider);
  const baseUrl = options.endpoint || providerConfig.baseUrl;
  const apiKey = options.apiKey || providerConfig.apiKey;
  const env: NodeJS.ProcessEnv = { ...sanitizedEnvironment(), OPENAI_BASE_URL: baseUrl };
  if (apiKey) env.OPENAI_API_KEY = apiKey;
  if (providerConfig.id === "nvidia-nim" && apiKey) env.NVIDIA_API_KEY = apiKey;
  if (providerConfig.id === "openrouter" && apiKey) env.OPENROUTER_API_KEY = apiKey;
  if (providerConfig.id === "freetoken") { env.FREETOKEN_BASE_URL = baseUrl; if (apiKey) env.FREETOKEN_API_KEY = apiKey; }
  return env;
}
export const buildRunnerEnv = buildPiRunnerEnv;

async function executeOnce(options: PiTaskOptions, taskId: string, taskText: string, iteration: number): Promise<PiTaskResult> {
  const { cwd, timeoutMs = 1800000 } = options;
  const startTime = Date.now();
  const providerConfig = resolveProvider(options.provider);
  const effectiveModel = options.model ? (options.provider && !options.model.includes("/") ? `${providerConfig.id}/${options.model}` : options.model) : `${providerConfig.id}/${providerConfig.defaultModel}`;
  const childEnv = buildPiRunnerEnv(options);
  const repositoryRoot = findGitRoot(cwd);
  let worktree: WorktreeInfo | undefined;
  let agentCwd = cwd;

  if (repositoryRoot) {
    worktree = createTaskWorktree(repositoryRoot, taskId);
    const cwdRelativeToRoot = relative(repositoryRoot, cwd);
    agentCwd = cwdRelativeToRoot ? join(worktree.path, cwdRelativeToRoot) : worktree.path;
  }

  const repos = findGitRepositories(agentCwd);
  for (const repo of repos) ensureLocalGitExclude(repo, ".pi-live.md");
  const beforeSnapshot = snapshotGit(agentCwd);
  const liveFilePath = join(agentCwd, ".pi-live.md");

  upsertTask({ id: taskId, status: "RUNNING", task: taskText, cwd, worktree: worktree?.path, provider: providerConfig.id, model: effectiveModel, createdAt: startTime, startedAt: startTime, retryCount: Math.max(0, iteration - 1), changedFiles: [] });
  emitTaskEvent({ type: "task_running", taskId, iteration, cwd: agentCwd, model: effectiveModel });

  return new Promise<PiTaskResult>((resolveResult) => {
    let stdout = ""; let stderr = ""; let timedOut = false; let lastWriteTime = 0; let writePending = false; let settled = false;
    const updateLiveFile = (isFinal = false, exitCode: number | null = null) => {
      try {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        let content = `# Pi Agent Live Activity\n\n> **Status**: ${isFinal ? (exitCode === 0 ? "COMPLETED" : "FAILED") : "RUNNING..."} (${elapsedSec}s elapsed)\n> **Model**: ${effectiveModel} • **Provider**: ${providerConfig.name}\n> **Task**: ${taskText}\n> **Iteration**: ${iteration}\n> **Workspace**: \`${agentCwd}\`\n\n---\n\n### Assistant Output Stream\n\n${stdout.trim() || "*Waiting for response generation...*"}\n`;
        if (isFinal) { const d = diffWorkerChanges(agentCwd, beforeSnapshot); content += `\n---\n\n### Files Modified\n\n${d.filesChanged.map((f) => `- \`${f}\``).join("\n") || "*No files modified.*"}\n\n### Git Changes\n\n\`\`\`\n${d.diffSummary}\n\`\`\`\n`; }
        writeFileSync(liveFilePath, content, "utf-8");
      } catch {}
    };
    const scheduleLiveUpdate = () => { const now = Date.now(); if (now - lastWriteTime > 250) { lastWriteTime = now; updateLiveFile(false); } else if (!writePending) { writePending = true; setTimeout(() => { writePending = false; lastWriteTime = Date.now(); updateLiveFile(false); }, 250); } };
    const finish = (status: "SUCCESS" | "FAILED" | "TIMED_OUT", code: number | null, error?: string) => {
      if (settled) return; settled = true; unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime; const d = diffWorkerChanges(agentCwd, beforeSnapshot);
      const verification = runVerificationPipeline(agentCwd);
      const finalStatus = status === "SUCCESS" && !verification.passed ? "FAILED" : status;
      const finalError = finalStatus === "FAILED" && status === "SUCCESS" ? "Deterministic verification failed" : error;
      updateLiveFile(true, code); emitTaskEvent({ type: "task_verifying", taskId, iteration, verification });
      emitTaskEvent({ type: "task_finished", taskId, status: finalStatus, durationMs, filesChanged: d.filesChanged, verification });
      upsertTask({ id: taskId, status: finalStatus === "SUCCESS" ? "APPROVED" : finalStatus === "TIMED_OUT" ? "FAILED" : "FAILED", task: taskText, cwd, worktree: worktree?.path, provider: providerConfig.id, model: effectiveModel, createdAt: startTime, startedAt: startTime, finishedAt: Date.now(), durationMs, exitCode: code, retryCount: Math.max(0, iteration - 1), changedFiles: d.filesChanged, error: finalError });
      if (worktree) { try { cleanupTaskWorktree(worktree, finalStatus !== "SUCCESS"); } catch {} }
      resolveResult({ status: finalStatus, taskId, cwd, task: taskText, durationMs, filesChanged: d.filesChanged, diffSummary: d.diffSummary, rawDiff: d.rawDiff, output: stdout.trim(), error: finalError, verification, iteration });
    };

    try {
      updateLiveFile(false);
      const piBin = resolvePiBinary() || "pi";
      const child = spawn(piBin, ["--print", "--no-session", "--model", effectiveModel, taskText], { cwd: agentCwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
      registerActiveTask(taskId, { child, cwd: agentCwd, task: taskText, startTime, worktree });
      emitTaskEvent({ type: "task_started", taskId, iteration, cwd: agentCwd, task: taskText, model: effectiveModel, startTime });
      const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGTERM"); setTimeout(() => { try { if (!child.killed) child.kill("SIGKILL"); } catch {} }, 3000); } catch {} }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { const delta = chunk.toString("utf-8"); stdout += delta; scheduleLiveUpdate(); emitTaskEvent({ type: "log_delta", taskId, delta }); });
      child.stderr.on("data", (chunk: Buffer) => { const delta = chunk.toString("utf-8"); stderr += delta; scheduleLiveUpdate(); emitTaskEvent({ type: "log_delta", taskId, delta }); });
      child.on("close", (code) => { clearTimeout(timer); finish(timedOut ? "TIMED_OUT" : code === 0 ? "SUCCESS" : "FAILED", code, code !== 0 ? (stderr.trim() || `Process exited with code ${code}`) : undefined); });
      child.on("error", (err) => { clearTimeout(timer); finish("FAILED", -1, `Failed to spawn Pi process ('${piBin}'): ${err.message}`); });
    } catch (error) { finish("FAILED", -1, error instanceof Error ? error.message : String(error)); }
  });
}

export async function runPiTask(options: PiTaskOptions): Promise<PiTaskResult> {
  ensureRecovered();
  const cwd = validateWorkspace(options.cwd);
  const maxIterations = Math.max(1, Math.min(options.maxIterations ?? 1, 3));
  const taskId = `pi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let prompt = options.task;
  let result: PiTaskResult | undefined;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    result = await executeOnce({ ...options, cwd }, taskId, prompt, iteration);
    if (result.status === "SUCCESS" && result.verification?.passed) return result;
    if (iteration < maxIterations) {
      const failures = result.verification?.checks.filter((check) => check.required && !check.passed).map((check) => `${check.name}: ${check.stderr || check.stdout}`).join("\n") || result.error || "Unknown failure";
      prompt = `${options.task}\n\nPrevious iteration failed verification. Repair the implementation and re-run the required checks. Do not undo correct work.\n\nVerification findings:\n${failures.slice(0, 8000)}`;
      emitTaskEvent({ type: "task_retry", taskId, iteration: iteration + 1, reason: failures.slice(0, 2000) });
    }
  }
  return result!;
}

export async function runDshTask(options: DshTaskOptions): Promise<DshTaskResult & PiTaskResult> {
  const piResult = await runPiTask({ cwd: options.cwd, task: options.task, model: options.model, timeoutMs: options.timeoutMs, verbose: options.verbose, maxIterations: options.maxIterations });
  return { ...piResult, summary: piResult.output || (piResult.status === "SUCCESS" ? "Task completed successfully." : "Task failed."), reasoning: "", gitDiffSummary: piResult.diffSummary, exitCode: piResult.status === "SUCCESS" ? 0 : 1, rawOutput: options.verbose ? piResult.output : undefined };
}
