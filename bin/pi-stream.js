#!/usr/bin/env node
/**
 * pi-stream.js: Real-time visual terminal stream formatter for Pi.
 * Runs `pi --mode json "$@"` and renders thinking, tool executions, and text deltas live.
 */

import { spawn } from "child_process";
import { appendFileSync } from "fs";

const args = process.argv.slice(2);
const logFile = process.env.LOG_FILE;

// ANSI Colors
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const piBin = process.env.PI_BIN || "pi";
const child = spawn(piBin, ["--mode", "json", ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

let inThinking = false;
let finalResponse = "";
let buf = "";

function handleEvent(ev) {
  if (ev.type === "message_update") {
    const sub = ev.assistantMessageEvent;
    if (sub?.type === "thinking_start") {
      inThinking = true;
      process.stdout.write(`\n${DIM}💭 Thinking: `);
    } else if (sub?.type === "thinking_delta") {
      process.stdout.write(`${DIM}${sub.delta}${RESET}`);
    } else if (sub?.type === "thinking_end" || sub?.type === "text_start") {
      if (inThinking) {
        process.stdout.write(`${RESET}\n\n`);
        inThinking = false;
      }
    } else if (sub?.type === "text_delta") {
      if (inThinking) {
        process.stdout.write(`${RESET}\n\n`);
        inThinking = false;
      }
      process.stdout.write(sub.delta);
      finalResponse += sub.delta;
    }
  } else if (ev.type === "tool_execution_start") {
    if (inThinking) {
      process.stdout.write(`${RESET}\n\n`);
      inThinking = false;
    }
    const toolName = ev.tool ?? "tool";
    const argSnippet = ev.args ? JSON.stringify(ev.args).slice(0, 80) : "";
    process.stdout.write(`\n${CYAN}⚙️  [${toolName}] ${argSnippet}${RESET}\n`);
  } else if (ev.type === "tool_execution_end") {
    process.stdout.write(`${GREEN}✔  Done${RESET}\n\n`);
  }
}

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      handleEvent(ev);
    } catch {}
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("close", (code) => {
  if (buf.trim()) {
    try {
      const ev = JSON.parse(buf);
      handleEvent(ev);
    } catch {}
  }
  if (inThinking) {
    process.stdout.write(`${RESET}\n\n`);
    inThinking = false;
  }
  if (logFile && finalResponse) {
    try {
      appendFileSync(logFile, finalResponse, "utf-8");
    } catch {}
  }
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`Failed to start pi: ${err.message}\n`);
  process.exit(1);
});
