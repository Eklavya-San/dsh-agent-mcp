import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { snapshotGit, diffWorkerChanges, findGitRepositories, ensureLocalGitExclude } from "./git.js";
import { resolveDshCommand } from "./dsh-bin.js";
import type { DshTaskOptions, DshTaskResult } from "./types.js";

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

export function cancelDshTask(taskId: string): boolean {
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
    return true;
  } catch {
    activeTasks.delete(taskId);
    return false;
  }
}


export function buildRunnerEnv(options: DshTaskOptions): NodeJS.ProcessEnv {
  const { model, endpoint, apiKey } = options;
  const effectiveEndpoint = endpoint || process.env.DSH_MODEL_ENDPOINT || process.env.OPENAI_BASE_URL;
  const effectiveModel = model || process.env.DSH_MODEL || process.env.OPENAI_MODEL_NAME;
  const effectiveKey = apiKey || process.env.DSH_API_KEY || process.env.OPENAI_API_KEY;

  return {
    ...process.env,
    DSH_PERMISSION_MODE: "danger-full-access",
    ...(effectiveEndpoint ? { DSH_MODEL_ENDPOINT: effectiveEndpoint, OPENAI_BASE_URL: effectiveEndpoint } : {}),
    ...(effectiveModel ? { DSH_MODEL: effectiveModel, OPENAI_MODEL_NAME: effectiveModel } : {}),
    ...(effectiveKey ? { DSH_API_KEY: effectiveKey, OPENAI_API_KEY: effectiveKey } : {}),
  };
}

export async function runDshTask(options: DshTaskOptions): Promise<DshTaskResult> {
  const { cwd, task, timeoutMs = 1800000, verbose = false } = options; // Default 30 min
  const startTime = Date.now();
  const taskId = `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const liveFilePath = join(cwd, ".dsh-live.md");
  const childEnv = buildRunnerEnv(options);

  // Ensure .dsh-live.md is excluded locally from git tracking in all workspace repos
  const repos = findGitRepositories(cwd);
  for (const repo of repos) {
    ensureLocalGitExclude(repo, ".dsh-live.md");
  }

  // 1. Snapshot git before starting
  const gitBefore = snapshotGit(cwd);

  return new Promise<DshTaskResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let lastWriteTime = 0;
    let writePending = false;
    const reasoningLines: string[] = [];
    const toolCallLines: string[] = [];

    // Helper to format and write .dsh-live.md for live progress inspection
    const updateLiveFile = (isFinal = false, exitCode: number | null = null) => {
      try {
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusIcon = isFinal
          ? exitCode === 0
            ? "🟢 COMPLETED"
            : "🔴 FAILED"
          : "🟡 RUNNING...";

        let content = `# ⚡ DeepSeek Harness Live Activity\n\n`;
        content += `> **Status**: ${statusIcon} (${elapsedSec}s elapsed)\n`;
        content += `> **Model**: ${childEnv.DSH_MODEL || "Configured DSH Model"} • **$0 Cost Execution**\n`;
        content += `> **Task**: ${task}\n`;
        content += `> **Workspace**: \`${cwd}\`\n\n`;
        content += `---\n\n`;

        if (toolCallLines.length > 0) {
          content += `### ⚙️ Tool Invocations (${toolCallLines.length})\n\n`;
          content += toolCallLines.slice(-10).map((t) => `- \`${t}\``).join("\n") + "\n\n";
          content += `---\n\n`;
        }

        content += `### 🧠 Real-Time Reasoning & Activity\n\n`;
        if (reasoningLines.length > 0) {
          content += reasoningLines.slice(-25).map((r) => `> ${r}`).join("\n\n") + "\n\n";
        } else {
          content += `*Executing tools and inspecting workspace...*\n\n`;
        }
        content += `---\n\n`;

        content += `### 📝 Assistant Output Stream\n\n`;
        if (stdout.trim().length > 0) {
          content += `${stdout.trim()}\n\n`;
        } else {
          content += `*Waiting for response generation...*\n\n`;
        }

        if (isFinal) {
          const { filesChanged, diffSummary } = diffWorkerChanges(cwd, gitBefore);
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

    const dshCmd = resolveDshCommand();
    const profile = options.profile || "headless";
    const spawnArgs = [...dshCmd.argsPrefix, "--profile", profile, task];

    const child = spawn(dshCmd.cmd, spawnArgs, {
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
      stdout += chunk.toString("utf-8");
      scheduleLiveUpdate();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      stderr += text;

      const lines = text.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes("reasoning:")) {
          reasoningLines.push(trimmed.replace(/^.*reasoning:\s*/, ""));
        } else if (trimmed.includes("tool:") || trimmed.includes("calling")) {
          toolCallLines.push(trimmed);
        }
      }
      scheduleLiveUpdate();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime;

      updateLiveFile(true, code);

      const { filesChanged, diffSummary } = diffWorkerChanges(cwd, gitBefore);

      const reasoning = reasoningLines.join("\n").trim();
      let summary = stdout.trim() || (code === 0 ? "Task completed successfully." : `Exited with code ${code}`);
      let errorMessage = code !== 0 ? stderr.trim() : undefined;

      // Detect if npm failed to install DSH
      if (
        code !== 0 &&
        (stderr.includes("403 Forbidden") ||
          stderr.includes("not found and will be installed") ||
          stderr.includes("E403") ||
          stderr.includes("ENOENT"))
      ) {
        const helpful =
          "\n\n[Diagnostic Note]: DeepSeek Harness binary could not be spawned or downloaded via npm. " +
          "Ensure 'dsh' is installed in PATH, or set the 'DSH_BIN' environment variable to your local dsh executable.";
        summary += helpful;
        errorMessage = (errorMessage || "") + helpful;
      }

      const status = timedOut
        ? "TIMED_OUT"
        : code === 0
        ? "SUCCESS"
        : "FAILED";

      resolve({
        status,
        taskId,
        cwd,
        task,
        durationMs,
        summary,
        reasoning,
        filesChanged,
        gitDiffSummary: diffSummary,
        exitCode: code,
        error: errorMessage,
        rawOutput: verbose ? stdout + "\n" + stderr : undefined,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      unregisterActiveTask(taskId);
      const durationMs = Date.now() - startTime;
      const helpful =
        `Failed to spawn DeepSeek Harness process ('${dshCmd.display}'). ` +
        "Please ensure 'dsh' is installed in PATH, or set DSH_BIN in your MCP environment configuration.";
      resolve({
        status: "FAILED",
        taskId,
        cwd,
        task,
        durationMs,
        summary: helpful,
        reasoning: "",
        filesChanged: [],
        gitDiffSummary: "None",
        exitCode: -1,
        error: `${err.message} (${helpful})`,
      });
    });
  });
}
