#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import readline from "readline";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";

// Configure marked with terminal renderer for syntax highlighting & table borders
marked.use(
  markedTerminal({
    width: Math.min(process.stdout.columns || 100, 120),
    reflowText: true,
    showSectionPrefix: false,
    tab: 2,
  })
);

// ANSI escape codes for rich terminal styling
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const magenta = (text) => `\x1b[35m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;

const task = process.argv.slice(2).join(" ");
if (!task) {
  console.error(red("Error: No task provided to dsh-stream."));
  process.exit(1);
}

const startTime = Date.now();
const modelName = process.env.DSH_MODEL || "Local / Free Model ($0 cost)";

console.log(bold(cyan("\n╭── DeepSeek Harness Subagent ─────────────────────────────────────────────")));
console.log(`${dim("│")} ${bold("Task:")} ${task}`);
console.log(`${dim("│")} ${bold("Model:")} ${modelName} • Live Markdown Rendering`);
console.log(bold(cyan("╰──────────────────────────────────────────────────────────────────────────\n")));

let dshCmd = "npx";
let dshArgsPrefix = ["-y", "@deepseek-ai/dsh"];

if (process.env.DSH_BIN && process.env.DSH_BIN.trim().length > 0) {
  dshCmd = process.env.DSH_BIN.trim();
  dshArgsPrefix = [];
} else {
  try {
    const which = execSync("which dsh", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (which) {
      dshCmd = which;
      dshArgsPrefix = [];
    }
  } catch {}
}

const childEnv = {
  ...process.env,
  DSH_PERMISSION_MODE: "danger-full-access",
  ...(process.env.DSH_MODEL_ENDPOINT ? { OPENAI_BASE_URL: process.env.DSH_MODEL_ENDPOINT } : {}),
  ...(process.env.DSH_MODEL ? { OPENAI_MODEL_NAME: process.env.DSH_MODEL } : {}),
  ...(process.env.DSH_API_KEY ? { OPENAI_API_KEY: process.env.DSH_API_KEY } : {}),
};

const child = spawn(dshCmd, [...dshArgsPrefix, "--profile", "headless", task], {
  env: childEnv,
  stdio: ["inherit", "pipe", "pipe"],
});

let assistantOutput = "";

// 1. Process stderr for real-time reasoning & tool calls
const rlErr = readline.createInterface({ input: child.stderr });
rlErr.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  if (line.includes("dsh: reasoning:")) {
    const text = line.replace(/^.*dsh: reasoning:\s*/, "").trim();
    if (text) {
      console.log(magenta("🧠 Thinking: ") + dim(text));
    }
  } else if (line.includes("tool:") || line.includes("calling")) {
    console.log(yellow("⚙️  Tool Call: ") + bold(trimmed));
  } else if (line.includes("exit_plan_mode") || line.includes("task completed")) {
    console.log(green("✔ Status: ") + trimmed);
  } else {
    console.log(dim("   " + trimmed));
  }
});

// 2. Accumulate stdout for live markdown rendering
child.stdout.on("data", (chunk) => {
  const text = chunk.toString("utf-8");
  assistantOutput += text;
  process.stdout.write(text);
});

child.on("close", (code) => {
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n");

  if (assistantOutput.trim().length > 0) {
    console.log(bold(cyan("╭── Rendered Markdown Output ──────────────────────────────────────────────")));
    try {
      const rendered = marked(assistantOutput.trim());
      console.log(rendered.trim());
    } catch {
      console.log(assistantOutput.trim());
    }
    console.log(bold(cyan("╰──────────────────────────────────────────────────────────────────────────\n")));
  }

  if (code === 0) {
    console.log(bold(green(`✔ Subagent finished successfully in ${elapsedSec}s.`)));
  } else {
    console.log(bold(red(`✖ Subagent exited with code ${code} after ${elapsedSec}s.`)));
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  console.error(bold(red(`\n✖ Failed to execute DeepSeek Harness: ${err.message}`)));
  process.exit(1);
});
