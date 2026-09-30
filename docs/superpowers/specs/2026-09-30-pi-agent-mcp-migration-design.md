# pi-agent-mcp: Migration from DSH to Pi Coding Agent Design Document

- **Date:** 2026-09-30
- **Author:** Antigravity & User Pair Programming
- **Status:** Approved / Ready for Implementation
- **Target Repository:** `/Users/eklavya/git-personal/dsh-agent-mcp` (migrating to `pi-agent-mcp`)

---

## 1. Executive Summary & Goals

DeepSeek Harness (`dsh`) presented binary installation issues and fragility in local environments. This project migrates the autonomous worker MCP server from `dsh` to **Pi Coding Agent** (`@earendil-works/pi-coding-agent`), which is already installed and verified on the host system (`pi v0.86.0`).

### Core Goals:
1. **Replace DSH Runner with Pi Execution**: Execute tasks via Pi (`pi --mode json` / `pi --print --no-session`).
2. **Integrated Terminal Live Streaming**: Bundle `bin/pi-live` and `bin/pi-stream.js` so Antigravity can execute Pi tasks with live real-time token streaming and tool visualization (`💭 Thinking`, `⚙️ [tool]`, `✔️ Done`) directly in the integrated terminal panel.
3. **Multi-Provider Routing**: Default to **FreeToken Qwen 35B** cluster ($0 cost), with support for NVIDIA NIM (1M context), local Ollama, and OpenRouter.
4. **Preserve Production Hardening**:
   - Multi-repo git discovery and aggregated diff tracking (`mw-frontend`, `mw-backend`, etc.).
   - Untracked clutter prevention via `.git/info/exclude` (for `.pi-live.md`).
   - In-memory process registry with `pi_cancel_task` (graceful `SIGTERM` + `SIGKILL` escalation).
   - Dedicated dual-agent review engine (`pi_review_task`).
5. **Environment & Tool Synchronization**: Update `~/.gemini/config/mcp_config.json`, setup scripts, and Antigravity rules.

---

## 2. Architecture & Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Antigravity (Lead Architect)                 │
└────────────────┬───────────────────────────────┬────────────────┘
                 │ (MCP Tool Calls)              │ (Terminal Commands)
                 ▼                               ▼
     ┌───────────────────────┐       ┌───────────────────────┐
     │  pi-agent-mcp Server  │       │   bin/pi-live (CLI)   │
     │  (build/mcp.js)       │       │   (Integrated Panel)  │
     └───────────┬───────────┘       └───────────┬───────────┘
                 │                               │
                 ▼                               ▼
     ┌───────────────────────────────────────────────────────┐
     │             Pi Worker Core & Providers                │
     │  - Providers: FreeToken Qwen 35B ($0), NIM, Ollama   │
     │  - Multi-Repo Git Diffing (mw-frontend, backend)      │
     │  - Process Registry & pi_cancel_task                  │
     │  - Automated QA Review Engine (pi_review_task)        │
     │  - Clean Git Workspace (.git/info/exclude)            │
     └───────────────────────────────────────────────────────┘
```

### Component Breakdown

1. **`bin/pi-live` & `bin/pi-stream.js`**:
   - High-speed visual stream formatter for terminal execution.
   - Spawns `pi --mode json`, streaming ANSI-colored thinking tokens, tool execution tags, and text deltas directly to Antigravity's terminal.
2. **`src/runner.ts` (`runPiTask`)**:
   - Headless MCP execution engine.
   - Discovers git repositories, registers `.pi-live.md` in `.git/info/exclude`, and takes initial git snapshots.
   - Spawns `pi` subprocess, tracks it in `activeTasks`, streams progress to `.pi-live.md`.
   - Computes aggregated multi-repo git diffs upon completion and returns structured JSON.
3. **`src/providers.ts`**:
   - Maps provider names (`freetoken`, `nvidia-nim`, `ollama`, `openrouter`) to base URLs, default models, and auth mechanisms.
4. **`src/git.ts`**:
   - Workspace repository discovery (`findGitRepositories`), git status, snapshotting, and multi-repo diffing.
   - Safe `.git/info/exclude` registration.
5. **`src/review.ts` (`runPiReview`)**:
   - Dual-agent QA verification engine.
   - Formats strict review prompts, executes test commands (`testCommand`, e.g. `npm test`), queries the inference endpoint, and parses verdicts (`APPROVED` or `NEEDS_REVISION`).
6. **`src/doctor.ts` (`runPiDoctor`)**:
   - Diagnoses `pi` binary availability and tests connectivity across configured providers.
7. **`src/mcp.ts`**:
   - Exposes MCP tools:
     - `pi_run_task`
     - `pi_doctor`
     - `pi_list_providers`
     - `pi_cancel_task`
     - `pi_list_active_tasks`
     - `pi_review_task`

---

## 3. Data Flow & Interfaces

### 3.1 `pi_run_task` Tool
```typescript
export interface PiTaskOptions {
  cwd: string;
  task: string;
  provider?: string;    // "freetoken" | "nvidia-nim" | "ollama" | "openrouter"
  model?: string;       // e.g. "Qwen3.6-35B-A3B-NVFP4", "qwen2.5-coder:32b"
  timeoutMs?: number;   // default: 30 minutes
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
```

### 3.2 `pi_review_task` Tool
```typescript
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
```

---

## 4. Provider & Model Routing

| Provider ID | Base URL (Default / Env) | Default Model | Best For | Cost |
|:---|:---|:---|:---|:---|
| **`freetoken` (Default)** | `http://machinewiseapp.in:10346/v1` | `Qwen3.6-35B-A3B-NVFP4` | 90% of coding tasks | **$0.00** |
| **`nvidia-nim`** | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3.5-lightning-30b-a3b` | 1M context / deep search | **$0.00** |
| **`ollama`** | `http://localhost:11434/v1` | `qwen2.5-coder:32b` | Offline / local execution | **$0.00** |
| **`openrouter`** | `https://openrouter.ai/api/v1` | `qwen/qwen3-coder` | Cloud extended models | Usage-based |

---

## 5. Process Lifecycle & Task Cancellation

- **Spawn & Registry**: Subprocesses spawned by `runPiTask` are added to `activeTasks: Map<string, ActiveTaskRecord>`.
- **Cancellation**:
  - `pi_cancel_task(taskId)` looks up the task, calls `child.kill("SIGTERM")`.
  - A fallback timer executes `child.kill("SIGKILL")` after 1,000ms if process is still alive.
  - Returns `{ taskId, cancelled: true, message: "..." }`.
- **Resource Disposal**: Unconditional cleanup of timers and map entries on process exit or error.

---

## 6. Testing Strategy

Comprehensive Vitest suite testing all modules with mock processes and isolated temporary directories:
1. `tests/pi-bin.test.ts`: Binary detection, PATH lookup, fallback logic.
2. `tests/providers.test.ts`: Provider URL resolution, auth header extraction, model fallback.
3. `tests/git.test.ts`: Single-repo and multi-repo traversal, porcelain status parsing, diff generation.
4. `tests/git-exclude.test.ts`: Idempotent registration of `.pi-live.md` in `.git/info/exclude`.
5. `tests/cancellation.test.ts`: Active registry tracking, listing, and cancellation execution.
6. `tests/review.test.ts`: Review prompt schema generation, strict JSON verdict parsing, unstructured text fallback parsing.
7. `tests/doctor.test.ts`: Health check diagnostics without network hanging in CI.

---

## 7. Migration & Environment Setup

- **`scripts/setup.sh`**:
  - Installs dependencies and builds `build/mcp.js`.
  - Configures `bin/pi-live` and `bin/pi-stream.js`.
  - Automatically updates `~/.gemini/config/mcp_config.json` with `pi-agent` server pointing to `build/mcp.js`.
  - Installs updated Antigravity rules and skills for dual-agent delegation.
