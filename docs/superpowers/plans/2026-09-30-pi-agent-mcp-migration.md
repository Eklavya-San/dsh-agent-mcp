# pi-agent-mcp Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform this repository from `dsh-agent-mcp` into `pi-agent-mcp`, replacing DSH with the Pi Coding Agent (`pi`) for both live terminal streaming in Antigravity and headless MCP execution, backed by FreeToken Qwen 35B ($0 cost), multi-repo git diffing, active task cancellation, and automated QA verification.

**Architecture:** 
- Bundle `bin/pi-live` and `bin/pi-stream.js` for integrated terminal streaming inside Antigravity's panel.
- Implement `src/runner.ts` (`runPiTask`) and `src/providers.ts` for provider routing (FreeToken default, NVIDIA NIM, Ollama, OpenRouter) and active task cancellation.
- Retain multi-repo git discovery, diff aggregation, and `.git/info/exclude` cleanliness (`.pi-live.md`).
- Implement `src/review.ts` (`runPiReview`) and expose `pi_run_task`, `pi_doctor`, `pi_list_providers`, `pi_cancel_task`, `pi_list_active_tasks`, and `pi_review_task` in `src/mcp.ts`.
- Update `scripts/setup.sh` to configure `~/.gemini/config/mcp_config.json` and install Antigravity rules.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node.js (>=20), @modelcontextprotocol/sdk, Vitest, Pi Coding Agent (`pi v0.86.0`).

## Global Constraints

- Must run on Node.js >= 20.0.0 without external native binaries.
- Zero paid API token dependencies required to run tests or local tasks (default to FreeToken Qwen 35B at $0 cost).
- Must support monorepos and subdirectories where `.git` is in a parent directory OR child subdirectories.
- All MCP tools must return valid MCP content objects with structured JSON.
- 100% test pass rate with 0 test timeouts before publishing.

---

### Task 1: Package Rebranding & Provider Routing Configuration

**Files:**
- Modify: `package.json`
- Modify: `src/types.ts`
- Create: `src/providers.ts`
- Create: `tests/providers.test.ts`

**Interfaces:**
- Consumes: Environment variables (`FREETOKEN_BASE_URL`, `NVIDIA_NIM_BASE_URL`, `OLLAMA_BASE_URL`).
- Produces: `resolveProvider(name?: string): ProviderConfig`, `listProviders(): ProviderConfig[]`, updated `PiTaskOptions`, `PiTaskResult`, `PiReviewOptions`, `PiReviewResult`.

- [ ] **Step 1: Write tests for provider resolution**

```typescript
// tests/providers.test.ts
import { describe, it, expect } from "vitest";
import { resolveProvider, listProviders } from "../src/providers.js";

describe("Provider Routing", () => {
  it("should default to freetoken provider when no provider is specified", () => {
    const provider = resolveProvider();
    expect(provider.id).toBe("freetoken");
    expect(provider.baseUrl).toContain("10346");
    expect(provider.defaultModel).toBe("Qwen3.6-35B-A3B-NVFP4");
  });

  it("should resolve nvidia-nim provider correctly", () => {
    const provider = resolveProvider("nvidia-nim");
    expect(provider.id).toBe("nvidia-nim");
    expect(provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(provider.defaultModel).toContain("nemotron");
  });

  it("should resolve ollama provider correctly", () => {
    const provider = resolveProvider("ollama");
    expect(provider.id).toBe("ollama");
    expect(provider.baseUrl).toContain("11434");
  });

  it("should list all configured providers", () => {
    const list = listProviders();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some(p => p.id === "freetoken")).toBe(true);
    expect(list.some(p => p.id === "nvidia-nim")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.ts`
Expected: FAIL (`providers.js` does not exist).

- [ ] **Step 3: Update `package.json` and implement `src/types.ts` and `src/providers.ts`**

In `package.json`:
- Change `"name": "pi-agent-mcp"`
- Change `"description": "Autonomous Pi Coding Agent MCP Server for Antigravity & Claude Code with multi-repo git diffing, live terminal streaming, and dual-agent QA verification"`
- Update `"bin"`:
  ```json
  "bin": {
    "pi-agent-mcp": "./build/mcp.js",
    "pi-live": "./bin/pi-live"
  }
  ```

In `src/types.ts`:
```typescript
export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  authHeader?: string;
}

export interface PiTaskOptions {
  cwd: string;
  task: string;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface PiTaskResult {
  status: "SUCCESS" | "FAILED" | "TIMED_OUT";
  taskId: string;
  cwd: string;
  task: string;
  durationMs: number;
  filesChanged: string[];
  diffSummary: string;
  rawDiff: string;
  output: string;
  error?: string;
}

export interface PiReviewOptions {
  cwd: string;
  brief: string;
  diff?: string;
  testCommand?: string;
  provider?: string;
  model?: string;
}

export interface PiReviewResult {
  verdict: "APPROVED" | "NEEDS_REVISION";
  summary: string;
  diffInspected: string;
  specCompliance: {
    compliant: boolean;
    missingRequirements: string[];
    unrequestedChanges: string[];
  };
  qualityAudit: {
    issues: Array<{ severity: "CRITICAL" | "IMPORTANT" | "MINOR"; description: string; file?: string }>;
    strengths: string[];
  };
  testResults?: {
    command: string;
    passed: boolean;
    output: string;
  };
}

export interface PiDoctorReport {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  piBinary: {
    installed: boolean;
    path?: string;
    version?: string;
  };
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    reachable: boolean;
    latencyMs?: number;
    error?: string;
  }>;
}
```

In `src/providers.ts`:
```typescript
import type { ProviderConfig } from "./types.js";

export function getProviders(): ProviderConfig[] {
  return [
    {
      id: "freetoken",
      name: "FreeToken Qwen Cluster ($0 cost)",
      baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
      defaultModel: process.env.FREETOKEN_MODEL || "Qwen3.6-35B-A3B-NVFP4",
      apiKey: process.env.FREETOKEN_API_KEY || "free-token",
    },
    {
      id: "nvidia-nim",
      name: "NVIDIA NIM (1M Context)",
      baseUrl: process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
      defaultModel: process.env.NVIDIA_NIM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
      apiKey: process.env.NVIDIA_NIM_API_KEY,
    },
    {
      id: "ollama",
      name: "Local Ollama",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      defaultModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b",
      apiKey: "ollama",
    },
    {
      id: "openrouter",
      name: "OpenRouter Cloud",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "qwen/qwen3-coder",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  ];
}

export function resolveProvider(name?: string): ProviderConfig {
  const providers = getProviders();
  if (!name) {
    const defaultId = process.env.PI_DEFAULT_PROVIDER || "freetoken";
    return providers.find(p => p.id === defaultId) || providers[0];
  }
  const match = providers.find(p => p.id.toLowerCase() === name.toLowerCase());
  if (!match) {
    // If not matching known preset, treat as custom provider or default to freetoken
    return {
      id: name,
      name,
      baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
      defaultModel: "Qwen3.6-35B-A3B-NVFP4",
    };
  }
  return match;
}

export function listProviders(): ProviderConfig[] {
  return getProviders();
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/providers.test.ts`
Expected: PASS (4 tests passing).

- [ ] **Step 5: Commit**

```bash
git add package.json src/types.ts src/providers.ts tests/providers.test.ts
git commit -m "feat(providers): add multi-provider routing and rebrand package to pi-agent-mcp"
```

---

### Task 2: Pi Binary Resolution & Diagnostic Doctor (`pi-bin` & `doctor`)

**Files:**
- Create: `src/pi-bin.ts`
- Create: `src/doctor.ts`
- Create: `tests/pi-bin.test.ts`
- Create: `tests/doctor.test.ts`
- Remove: `src/dsh-bin.ts`, `tests/dsh-bin.test.ts`

**Interfaces:**
- Consumes: System PATH, `process.env.PI_BIN`.
- Produces: `resolvePiBinary(): string | null`, `checkPiInstalled(): { installed: boolean; path?: string; version?: string }`, `runPiDoctor(): Promise<PiDoctorReport>`.

- [ ] **Step 1: Write tests for binary resolution & doctor**

```typescript
// tests/pi-bin.test.ts
import { describe, it, expect } from "vitest";
import { resolvePiBinary, checkPiInstalled } from "../src/pi-bin.js";

describe("Pi Binary Resolution", () => {
  it("should resolve pi binary path or return null gracefully", () => {
    const bin = resolvePiBinary();
    expect(bin === null || typeof bin === "string").toBe(true);
  });

  it("should return checkPiInstalled report without throwing", () => {
    const report = checkPiInstalled();
    expect(typeof report.installed).toBe("boolean");
    if (report.installed) {
      expect(report.path).toBeDefined();
    }
  });
});
```

```typescript
// tests/doctor.test.ts
import { describe, it, expect } from "vitest";
import { runPiDoctor } from "../src/doctor.js";

describe("Pi Doctor Diagnostics", () => {
  it("should return structured health report without hanging", async () => {
    const report = await runPiDoctor();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.status);
    expect(Array.isArray(report.providers)).toBe(true);
    expect(typeof report.piBinary.installed).toBe("boolean");
  }, 10000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pi-bin.test.ts tests/doctor.test.ts`
Expected: FAIL (`pi-bin.js` not found).

- [ ] **Step 3: Implement `src/pi-bin.ts` and `src/doctor.ts`**

In `src/pi-bin.ts`:
```typescript
import { execSync } from "child_process";
import { existsSync } from "fs";

let cachedBin: string | null | undefined;

export function resolvePiBinary(): string | null {
  if (cachedBin !== undefined) return cachedBin;

  if (process.env.PI_BIN && existsSync(process.env.PI_BIN)) {
    cachedBin = process.env.PI_BIN;
    return cachedBin;
  }

  try {
    const resolved = execSync("which pi", { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (resolved && existsSync(resolved)) {
      cachedBin = resolved;
      return cachedBin;
    }
  } catch {}

  cachedBin = null;
  return null;
}

export function checkPiInstalled(): { installed: boolean; path?: string; version?: string } {
  const bin = resolvePiBinary();
  if (!bin) {
    return { installed: false };
  }

  try {
    const version = execSync(`"${bin}" --version`, { encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { installed: true, path: bin, version };
  } catch {
    return { installed: true, path: bin, version: "unknown" };
  }
}
```

In `src/doctor.ts`:
```typescript
import http from "http";
import https from "https";
import { checkPiInstalled } from "./pi-bin.js";
import { getProviders } from "./providers.js";
import type { PiDoctorReport } from "./types.js";

async function checkProviderHealth(urlStr: string, timeoutMs = 2500): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === "https:" ? https : http;

    return await new Promise((resolve) => {
      const req = client.request(
        parsed,
        { method: "GET", timeout: timeoutMs },
        () => resolve({ reachable: true, latencyMs: Date.now() - start })
      );
      req.on("error", (err) => resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ reachable: false, latencyMs: timeoutMs, error: "Timed out" });
      });
      req.end();
    });
  } catch (err: any) {
    return { reachable: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export async function runPiDoctor(): Promise<PiDoctorReport> {
  const piCheck = checkPiInstalled();
  const providers = getProviders();

  const providerResults = await Promise.all(
    providers.map(async (p) => {
      const check = await checkProviderHealth(p.baseUrl);
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.defaultModel,
        reachable: check.reachable,
        latencyMs: check.latencyMs,
        error: check.error,
      };
    })
  );

  const reachableCount = providerResults.filter(p => p.reachable).length;
  let status: "HEALTHY" | "DEGRADED" | "DOWN" = "DOWN";

  if (piCheck.installed && reachableCount > 0) {
    status = reachableCount >= 2 ? "HEALTHY" : "DEGRADED";
  }

  return {
    status,
    piBinary: piCheck,
    providers: providerResults,
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/pi-bin.test.ts tests/doctor.test.ts`
Expected: PASS.

- [ ] **Step 5: Clean up old DSH files and commit**

```bash
git rm -f src/dsh-bin.ts tests/dsh-bin.test.ts 2>/dev/null || true
git add src/pi-bin.ts src/doctor.ts tests/pi-bin.test.ts tests/doctor.test.ts
git commit -m "feat(doctor): implement pi binary resolver and multi-provider health diagnostics"
```

---

### Task 3: Integrated Terminal Streamer CLI (`bin/pi-live` & `bin/pi-stream.js`)

**Files:**
- Create: `bin/pi-stream.js`
- Create: `bin/pi-live`

**Interfaces:**
- CLI: `pi-live [--cwd <dir>] [--model <model>] [--provider <provider>] "<task>"`
- Streams thinking deltas, tool executions, and text deltas directly to stdout with ANSI styling.

- [ ] **Step 1: Implement `bin/pi-stream.js`**

```javascript
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

const child = spawn("pi", ["--mode", "json", ...args], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

let inThinking = false;
let finalResponse = "";
let buf = "";

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);

      // Thinking start / delta / end
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
    } catch {}
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("close", (code) => {
  if (logFile && finalResponse) {
    try {
      appendFileSync(logFile, finalResponse, "utf-8");
    } catch {}
  }
  process.exit(code ?? 0);
});
```

- [ ] **Step 2: Implement `bin/pi-live`**

```bash
#!/usr/bin/env bash
# pi-live: Runs Pi directly inside the integrated terminal with real-time streaming output.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STREAMER="${SCRIPT_DIR}/pi-stream.js"

CWD="$(pwd)"
MODEL=""
PROVIDER="freetoken"
TASK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cwd)
      CWD="$2"
      shift 2
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --provider)
      PROVIDER="$2"
      shift 2
      ;;
    *)
      TASK="$1"
      shift
      ;;
  esac
done

if [ -z "$TASK" ]; then
  echo "Usage: pi-live [--cwd <path>] [--model <model>] [--provider <provider>] \"<task prompt>\""
  exit 1
fi

MODEL_ARG=""
if [ -n "$MODEL" ]; then
  MODEL_ARG="--model ${MODEL}"
elif [ "$PROVIDER" = "freetoken" ]; then
  MODEL_ARG="--model freetoken/Qwen3.6-35B-A3B-NVFP4"
fi

cd "${CWD}"
exec node "${STREAMER}" ${MODEL_ARG} --no-session "${TASK}"
```

- [ ] **Step 3: Make executable and verify invocation**

Run: `chmod +x bin/pi-live bin/pi-stream.js && ./bin/pi-live --help 2>&1 || true`
Expected: Outputs usage instructions without crashing.

- [ ] **Step 4: Commit**

```bash
git add bin/pi-live bin/pi-stream.js
git commit -m "feat(cli): add pi-live terminal streamer for Antigravity panel visibility"
```

---

### Task 4: Headless Task Runner with Multi-Repo Diff & Process Cancellation

**Files:**
- Modify: `src/git.ts`
- Modify: `src/runner.ts`
- Modify: `tests/git-exclude.test.ts`
- Modify: `tests/cancellation.test.ts`

**Interfaces:**
- Consumes: `PiTaskOptions`, `resolveProvider()`, `resolvePiBinary()`.
- Produces: `runPiTask(opts: PiTaskOptions): Promise<PiTaskResult>`, `registerActiveTask()`, `cancelPiTask()`, `listActiveTasks()`.

- [ ] **Step 1: Write cancellation and exclude tests**

Update `tests/git-exclude.test.ts` to test `.pi-live.md` exclude registration.
Update `tests/cancellation.test.ts`:

```typescript
// tests/cancellation.test.ts
import { describe, it, expect } from "vitest";
import { cancelPiTask, listActiveTasks, registerActiveTask, unregisterActiveTask } from "../src/runner.js";

describe("Pi Task Cancellation & Active Registry", () => {
  it("should register, list, and unregister active Pi tasks", () => {
    const mockChild: any = { kill: () => true };
    registerActiveTask("task-123", {
      child: mockChild,
      cwd: "/test/dir",
      task: "test task prompt",
      startTime: Date.now(),
    });

    const active = listActiveTasks();
    expect(active.some((t) => t.taskId === "task-123")).toBe(true);

    const cancelled = cancelPiTask("task-123");
    expect(cancelled).toBe(true);

    const after = listActiveTasks();
    expect(after.some((t) => t.taskId === "task-123")).toBe(false);
  });

  it("should return false when cancelling non-existent task", () => {
    expect(cancelPiTask("non-existent-task")).toBe(false);
  });
});
```

- [ ] **Step 2: Update `src/git.ts` to default to `.pi-live.md`**

In `src/git.ts`:
Change default entry parameter in `ensureLocalGitExclude(repoRoot: string, entry = ".pi-live.md"): boolean`.

- [ ] **Step 3: Implement `src/runner.ts` for Pi execution**

```typescript
import { spawn, type ChildProcess } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { snapshotGit, diffWorkerChanges, findGitRepositories, ensureLocalGitExclude } from "./git.js";
import { resolvePiBinary } from "./pi-bin.js";
import { resolveProvider } from "./providers.js";
import type { PiTaskOptions, PiTaskResult } from "./types.js";

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
    return true;
  } catch {
    activeTasks.delete(taskId);
    return false;
  }
}

export async function runPiTask(options: PiTaskOptions): Promise<PiTaskResult> {
  const { cwd, task, provider: providerName, model: modelOverride, timeoutMs = 1800000, verbose } = options;
  const taskId = `pi-${Date.now()}`;
  const startTime = Date.now();

  const piBin = resolvePiBinary();
  if (!piBin) {
    throw new Error("Pi binary ('pi') not found. Please ensure it is installed via npm or in PATH.");
  }

  const provider = resolveProvider(providerName);
  const effectiveModel = modelOverride || `${provider.id}/${provider.defaultModel}`;

  // 1. Exclude .pi-live.md locally
  const repos = findGitRepositories(cwd);
  for (const repo of repos) {
    ensureLocalGitExclude(repo, ".pi-live.md");
  }

  // 2. Snapshot Git before changes
  const beforeSnapshot = snapshotGit(cwd);

  const liveLogPath = join(cwd, ".pi-live.md");
  writeFileSync(liveLogPath, `# Pi Task Live Log [${taskId}]\nTask: ${task}\n\nStarting Pi...\n`, "utf-8");

  // 3. Spawn Pi in non-interactive print mode
  const args = [
    "--print",
    "--no-session",
    "--model", effectiveModel,
    task,
  ];

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(piBin, args, {
      cwd,
      env: {
        ...process.env,
        ...(provider.baseUrl ? { [`${provider.id.toUpperCase()}_BASE_URL`]: provider.baseUrl } : {}),
        ...(provider.apiKey ? { [`${provider.id.toUpperCase()}_API_KEY`]: provider.apiKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    registerActiveTask(taskId, { child, cwd, task, startTime });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      try {
        writeFileSync(liveLogPath, `# Pi Task Live Log [${taskId}]\nTask: ${task}\n\n${stdout.slice(-4000)}`, "utf-8");
      } catch {}
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      cancelPiTask(taskId);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      unregisterActiveTask(taskId);

      const diffResult = diffWorkerChanges(cwd, beforeSnapshot);
      const durationMs = Date.now() - startTime;

      if (timedOut) {
        return resolve({
          status: "TIMED_OUT",
          taskId,
          cwd,
          task,
          durationMs,
          filesChanged: diffResult.filesChanged,
          diffSummary: diffResult.diffSummary,
          rawDiff: diffResult.rawDiff,
          output: stdout,
          error: `Execution timed out after ${timeoutMs}ms`,
        });
      }

      resolve({
        status: code === 0 ? "SUCCESS" : "FAILED",
        taskId,
        cwd,
        task,
        durationMs,
        filesChanged: diffResult.filesChanged,
        diffSummary: diffResult.diffSummary,
        rawDiff: diffResult.rawDiff,
        output: verbose ? stdout + (stderr ? `\nSTDERR:\n${stderr}` : "") : stdout,
        error: code !== 0 ? `Pi exited with code ${code}: ${stderr.slice(0, 500)}` : undefined,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      unregisterActiveTask(taskId);
      const diffResult = diffWorkerChanges(cwd, beforeSnapshot);
      resolve({
        status: "FAILED",
        taskId,
        cwd,
        task,
        durationMs: Date.now() - startTime,
        filesChanged: diffResult.filesChanged,
        diffSummary: diffResult.diffSummary,
        rawDiff: diffResult.rawDiff,
        output: stdout,
        error: `Process error: ${err.message}`,
      });
    });
  });
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/cancellation.test.ts tests/git-exclude.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/git.ts src/runner.ts tests/cancellation.test.ts tests/git-exclude.test.ts
git commit -m "feat(runner): implement headless runPiTask with multi-repo diffing and active task cancellation"
```

---

### Task 5: Dedicated Dual-Agent Reviewer Engine (`src/review.ts`)

**Files:**
- Modify: `src/review.ts`
- Modify: `tests/review.test.ts`

**Interfaces:**
- Consumes: `PiReviewOptions`, `resolveProvider()`, `snapshotGit()`, `diffWorkerChanges()`.
- Produces: `runPiReview(options: PiReviewOptions): Promise<PiReviewResult>`, `formatPiReviewPrompt()`, `parsePiReviewVerdict()`.

- [ ] **Step 1: Update `tests/review.test.ts`**

```typescript
// tests/review.test.ts
import { describe, it, expect } from "vitest";
import { formatPiReviewPrompt, parsePiReviewVerdict } from "../src/review.js";

describe("Pi Review Engine", () => {
  it("should format review prompt including brief and diff", () => {
    const prompt = formatPiReviewPrompt({
      cwd: "/test",
      brief: "Refactor database query",
      diff: "diff --git a/file.ts",
      testCommand: "npm test",
    });

    expect(prompt).toContain("## ARCHITECT BRIEF");
    expect(prompt).toContain("Refactor database query");
    expect(prompt).toContain("## GIT DIFF UNDER REVIEW");
    expect(prompt).toContain("npm test");
  });

  it("should parse strict JSON APPROVED verdict", () => {
    const jsonOutput = JSON.stringify({
      verdict: "APPROVED",
      summary: "Clean implementation matching all requirements.",
      specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
      qualityAudit: { issues: [], strengths: ["Solid error handling"] },
    });

    const parsed = parsePiReviewVerdict(jsonOutput);
    expect(parsed.verdict).toBe("APPROVED");
    expect(parsed.specCompliance.compliant).toBe(true);
  });

  it("should parse NEEDS_REVISION verdict cleanly", () => {
    const jsonOutput = JSON.stringify({
      verdict: "NEEDS_REVISION",
      summary: "Missing tests.",
      specCompliance: { compliant: false, missingRequirements: ["Unit tests"], unrequestedChanges: [] },
      qualityAudit: { issues: [{ severity: "CRITICAL", description: "No tests", file: "test.ts" }], strengths: [] },
    });

    const parsed = parsePiReviewVerdict(jsonOutput);
    expect(parsed.verdict).toBe("NEEDS_REVISION");
  });
});
```

- [ ] **Step 2: Implement `src/review.ts`**

```typescript
import { execSync } from "child_process";
import http from "http";
import https from "https";
import { diffWorkerChanges, snapshotGit } from "./git.js";
import { resolveProvider } from "./providers.js";
import type { PiReviewOptions, PiReviewResult } from "./types.js";

export function formatPiReviewPrompt(options: PiReviewOptions): string {
  return `You are an expert code reviewer and QA verifier.
Audit this change against the architect's intent brief.

## ARCHITECT BRIEF:
${options.brief}

## GIT DIFF UNDER REVIEW:
${options.diff || "None"}

${options.testCommand ? `## TEST COMMAND:\n${options.testCommand}` : ""}

Return a strictly valid JSON object matching this schema:
{
  "verdict": "APPROVED" | "NEEDS_REVISION",
  "summary": "1-3 sentence evaluation",
  "specCompliance": {
    "compliant": boolean,
    "missingRequirements": string[],
    "unrequestedChanges": string[]
  },
  "qualityAudit": {
    "issues": [{"severity": "CRITICAL"|"IMPORTANT"|"MINOR", "description": string, "file": string}],
    "strengths": string[]
  }
}`;
}

export function parsePiReviewVerdict(rawText: string): PiReviewResult {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verdict: parsed.verdict === "APPROVED" ? "APPROVED" : "NEEDS_REVISION",
        summary: parsed.summary || "Review completed.",
        diffInspected: "",
        specCompliance: parsed.specCompliance || { compliant: parsed.verdict === "APPROVED", missingRequirements: [], unrequestedChanges: [] },
        qualityAudit: parsed.qualityAudit || { issues: [], strengths: [] },
      };
    }
  } catch {}

  const isApproved = /\[?APPROVED\]?/i.test(rawText) && !/NEEDS[ _-]?REVISION/i.test(rawText);
  return {
    verdict: isApproved ? "APPROVED" : "NEEDS_REVISION",
    summary: rawText.slice(0, 500),
    diffInspected: "",
    specCompliance: { compliant: isApproved, missingRequirements: [], unrequestedChanges: [] },
    qualityAudit: { issues: [], strengths: [] },
  };
}

export async function runPiReview(options: PiReviewOptions): Promise<PiReviewResult> {
  const { cwd, brief, testCommand, provider: providerName, model: modelOverride } = options;

  // 1. Resolve diff if not provided
  let effectiveDiff = options.diff;
  if (!effectiveDiff) {
    const snapshot = snapshotGit(cwd);
    const diffResult = diffWorkerChanges(cwd, snapshot);
    effectiveDiff = diffResult.rawDiff || diffResult.diffSummary;
  }

  // 2. Run test command if specified
  let testExecResult: { command: string; passed: boolean; output: string } | undefined;
  if (testCommand) {
    try {
      const out = execSync(testCommand, { cwd, encoding: "utf-8", timeout: 120000 });
      testExecResult = { command: testCommand, passed: true, output: out.slice(0, 4000) };
    } catch (err: any) {
      testExecResult = { command: testCommand, passed: false, output: (err.stdout || err.message || "").slice(0, 4000) };
    }
  }

  // 3. Connect to provider endpoint
  const provider = resolveProvider(providerName);
  const model = modelOverride || provider.defaultModel;
  const prompt = formatPiReviewPrompt({ ...options, diff: effectiveDiff });

  let reviewResponse = "";
  try {
    const isHttps = provider.baseUrl.startsWith("https://");
    const client = isHttps ? https : http;
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    const parsedUrl = new URL(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`);
    reviewResponse = await new Promise<string>((resolve, reject) => {
      const req = client.request(
        parsedUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
          },
          timeout: 45000,
        },
        (res) => {
          let data = "";
          res.on("data", chunk => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(json.choices?.[0]?.message?.content || data);
            } catch {
              resolve(data);
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Review request timed out"));
      });
      req.write(body);
      req.end();
    });
  } catch (err: any) {
    reviewResponse = `[Auto-Fallback]: Review connection failed (${err.message}). Defaulting to manual verification check.`;
  }

  const result = parsePiReviewVerdict(reviewResponse);
  result.diffInspected = (effectiveDiff || "").slice(0, 4000);
  if (testExecResult) {
    result.testResults = testExecResult;
    if (!testExecResult.passed) {
      result.verdict = "NEEDS_REVISION";
      result.summary += ` [Tests Failed: ${testCommand}]`;
    }
  }

  return result;
}
```

- [ ] **Step 3: Run tests to verify all pass**

Run: `npx vitest run tests/review.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/review.ts tests/review.test.ts
git commit -m "feat(review): implement pi_review_task QA verification engine"
```

---

### Task 6: MCP Server Protocol Wiring (`src/mcp.ts`)

**Files:**
- Modify: `src/mcp.ts`
- Remove: `src/sessions.ts`, `tests/sessions.test.ts` (dsh-specific legacy sessions)

**Interfaces:**
- Exposes tools via MCP Stdio:
  - `pi_run_task`
  - `pi_doctor`
  - `pi_list_providers`
  - `pi_cancel_task`
  - `pi_list_active_tasks`
  - `pi_review_task`

- [ ] **Step 1: Implement `src/mcp.ts` with Pi tools**

In `src/mcp.ts`:
- Define `TOOLS` array with schemas for `pi_run_task`, `pi_doctor`, `pi_list_providers`, `pi_cancel_task`, `pi_list_active_tasks`, and `pi_review_task`.
- Implement `CallToolRequestSchema` handler routing each tool to `runPiTask`, `runPiDoctor`, `listProviders`, `cancelPiTask`, `listActiveTasks`, and `runPiReview`.
- Return valid MCP content blocks (`[{ type: "text", text: JSON.stringify(...) }]`).

- [ ] **Step 2: Clean up legacy DSH session files**

Run: `git rm -f src/sessions.ts tests/sessions.test.ts 2>/dev/null || true`

- [ ] **Step 3: Verify TypeScript build and tests**

Run: `npm run build && npm test`
Expected: 100% tests pass (all suites green), clean compilation.

- [ ] **Step 4: Commit**

```bash
git add src/mcp.ts
git commit -m "feat(mcp): expose pi_run_task, pi_doctor, pi_review_task, and active process tools"
```

---

### Task 7: Setup Script & Antigravity Synchronization

**Files:**
- Modify: `scripts/setup.sh`
- Modify: `integrations/antigravity/rules/AGENTS.md`
- Modify: `integrations/antigravity/skills/dsh-orchestration/SKILL.md` -> rename to `pi-orchestration/SKILL.md`

**Interfaces:**
- Automated 1-command installer: compiles TypeScript, verifies `pi` binary, updates `~/.gemini/config/mcp_config.json`, and registers Antigravity dual-agent rules.

- [ ] **Step 1: Update `scripts/setup.sh`**

In `scripts/setup.sh`:
- Check for `node` and `pi` binaries.
- Compile TypeScript to `build/mcp.js`.
- Make `bin/pi-live` and `bin/pi-stream.js` executable.
- Update `~/.gemini/config/mcp_config.json`:
  ```json
  "pi-agent": {
    "command": "node",
    "args": ["${REPO_DIR}/build/mcp.js"],
    "env": {
      "FREETOKEN_BASE_URL": "http://machinewiseapp.in:10346/v1",
      "PI_DEFAULT_PROVIDER": "freetoken"
    }
  }
  ```
- Copy updated `AGENTS.md` to `~/.gemini/config/rules/AGENTS.md`.

- [ ] **Step 2: Update Antigravity integration rules (`AGENTS.md`)**

In `integrations/antigravity/rules/AGENTS.md`:
- Change Agent 1 to `pi-worker` (`pi-live` / `pi_run_task` on FreeToken Qwen 35B).
- Change Agent 2 to `reviewer-worker` (`pi_review_task`).

- [ ] **Step 3: Run setup script and execute full verification suite**

Run: `./scripts/setup.sh && npm test && npm run doctor`
Expected:
- Clean build exit 0.
- `mcp_config.json` updated with active build path.
- 100% tests pass.
- `npm run doctor` returns structured status report.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/setup.sh integrations/
git commit -m "feat(setup): add automated Antigravity configuration and sync for pi-agent-mcp"
git push origin main
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-30-pi-agent-mcp-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
