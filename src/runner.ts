import { spawn } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { snapshotGit, diffWorkerChanges } from "./git.js";
import type { DshTaskOptions, DshTaskResult } from "./types.js";

export async function runDshTask(options: DshTaskOptions): Promise<DshTaskResult> {
  const { cwd, task, timeoutMs = 1800000, verbose = false } = options; // Default 30 min
  const startTime = Date.now();
  const taskId = `dsh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const liveFilePath = join(cwd, ".dsh-live.md");

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
        content += `> **Model**: ${process.env.DSH_MODEL || "Configured DSH Model"} • **$0 Cost Execution**\n`;
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

    // Use npx -y @deepseek-ai/dsh with headless profile
    const child = spawn("npx", ["-y", "@deepseek-ai/dsh", "--profile", "headless", task], {
      cwd,
      env: {

        ...process.env,
        DSH_PERMISSION_MODE: "danger-full-access",
      },
      stdio: ["ignore", "pipe", "pipe"],
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
      const durationMs = Date.now() - startTime;

      updateLiveFile(true, code);

      const { filesChanged, diffSummary } = diffWorkerChanges(cwd, gitBefore);

      const reasoning = reasoningLines.join("\n").trim();
      const summary = stdout.trim() || (code === 0 ? "Task completed successfully." : `Exited with code ${code}`);

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
        error: code !== 0 ? stderr.trim() : undefined,
        rawOutput: verbose ? stdout + "\n" + stderr : undefined,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        status: "FAILED",
        taskId,
        cwd,
        task,
        durationMs,
        summary: "Failed to spawn DeepSeek Harness process",
        reasoning: "",
        filesChanged: [],
        gitDiffSummary: "None",
        exitCode: -1,
        error: err.message,
      });
    });
  });
}
