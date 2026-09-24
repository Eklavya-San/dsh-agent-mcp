# dsh-agent-mcp v2 Production Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `dsh-agent-mcp` to support multi-repo workspace diffing, native dual-agent review tooling (`dsh_review_task`), dynamic model/endpoint selection, zero git-status clutter, task cancellation, and active environment synchronization with Antigravity.

**Architecture:** 
- Enhance `src/git.ts` with multi-repo discovery that discovers sub-repositories when `cwd` is a parent directory (e.g. `mw-frontend`, `mw-backend`) and registers `.dsh-live.md` in `.git/info/exclude`.
- Expand `DshTaskOptions` in `src/types.ts` and `src/runner.ts` to accept runtime `model`, `endpoint`, and `apiKey` overrides.
- Add an in-memory process registry in `src/runner.ts` and expose `dsh_cancel_task` in `src/mcp.ts`.
- Build a dedicated reviewer engine in `src/review.ts` and expose `dsh_review_task` in `src/mcp.ts` to give Agent 2 a zero-cost structured review verdict.
- Update `scripts/setup.sh` to configure and verify `~/.gemini/config/mcp_config.json`.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node.js (>=20), @modelcontextprotocol/sdk, Vitest.

## Global Constraints

- Must run on Node.js >= 20.0.0 without external native binaries.
- Zero paid API token dependencies required to run tests or local tasks.
- Must support monorepos and subdirectories where `.git` is in a parent directory OR child subdirectories.
- All MCP tools must return valid MCP content objects with structured JSON.
- 100% test pass rate with 0 test timeouts before publishing.

---

### Task 1: Multi-Repo & Subfolder Git Discovery & Aggregated Diffing

**Files:**
- Modify: `src/git.ts`
- Modify: `tests/git.test.ts`

**Interfaces:**
- Consumes: `cwd: string`, `before: GitSnapshot`
- Produces: `findGitRepositories(cwd: string): string[]`, aggregated multi-repo `snapshotGit(cwd: string)` and `diffWorkerChanges(cwd: string, before: GitSnapshot)`

- [ ] **Step 1: Write unit tests for multi-repo discovery and snapshotting**

```typescript
// tests/git.test.ts (append to file)
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { snapshotGit, diffWorkerChanges, findGitRoot, findGitRepositories } from "../src/git.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("Multi-Repo Git Traversal", () => {
  const testDir = join(process.cwd(), "tests", "scratch-multi-repo");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, "repo-frontend"), { recursive: true });
    mkdirSync(join(testDir, "repo-backend"), { recursive: true });

    // Initialize sub-repos
    execSync("git init", { cwd: join(testDir, "repo-frontend"), stdio: "ignore" });
    execSync("git init", { cwd: join(testDir, "repo-backend"), stdio: "ignore" });

    writeFileSync(join(testDir, "repo-frontend", "fileA.txt"), "hello frontend");
    writeFileSync(join(testDir, "repo-backend", "fileB.txt"), "hello backend");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should discover multiple sub-repositories when cwd is a non-git parent", () => {
    const repos = findGitRepositories(testDir);
    expect(repos.length).toBe(2);
    expect(repos.some(r => r.endsWith("repo-frontend"))).toBe(true);
    expect(repos.some(r => r.endsWith("repo-backend"))).toBe(true);
  });

  it("should snapshot and diff files across multiple child repositories", () => {
    const before = snapshotGit(testDir);
    expect(Array.isArray(before.files)).toBe(true);

    // Modify a file in repo-frontend
    writeFileSync(join(testDir, "repo-frontend", "fileA.txt"), "modified frontend");

    const diff = diffWorkerChanges(testDir, before);
    expect(diff.filesChanged.length).toBeGreaterThan(0);
    expect(diff.diffSummary).not.toBe("Unable to calculate git diff");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git.test.ts`
Expected: FAIL (missing `findGitRepositories` export or multi-repo handling).

- [ ] **Step 3: Implement multi-repo discovery in `src/git.ts`**

```typescript
// src/git.ts
import { execSync } from "child_process";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, relative } from "path";

export interface GitSnapshot {
  commit: string;
  status: string;
  files: string[];
  gitRoot?: string;
  subRepos?: string[];
}

export function findGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function findGitRepositories(cwd: string): string[] {
  const root = findGitRoot(cwd);
  if (root) return [root];

  const repos: string[] = [];
  try {
    const entries = readdirSync(cwd);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const fullPath = join(cwd, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          if (existsSync(join(fullPath, ".git"))) {
            repos.push(fullPath);
          }
        }
      } catch {}
    }
  } catch {}

  return repos;
}

export function snapshotGit(cwd: string): GitSnapshot {
  const repos = findGitRepositories(cwd);

  if (repos.length === 0) {
    return { commit: "unknown", status: "", files: [], gitRoot: undefined, subRepos: [] };
  }

  if (repos.length === 1) {
    const root = repos[0];
    try {
      const commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const files = status
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.slice(3).trim());

      return { commit, status, files, gitRoot: root, subRepos: [root] };
    } catch {
      return { commit: "unknown", status: "", files: [], gitRoot: root, subRepos: [root] };
    }
  }

  // Multi-repo workspace (e.g. mw-fullstack containing mw-frontend and mw-backend)
  const allFiles: string[] = [];
  const statusLines: string[] = [];
  const commits: string[] = [];

  for (const repo of repos) {
    const relPrefix = relative(cwd, repo);
    try {
      const commit = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      commits.push(`${relPrefix}:${commit.slice(0, 7)}`);
      const status = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = status.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        statusLines.push(`${line.slice(0, 3)}${relPrefix}/${line.slice(3).trim()}`);
        allFiles.push(`${relPrefix}/${line.slice(3).trim()}`);
      }
    } catch {}
  }

  return {
    commit: commits.join(", ") || "multi-repo",
    status: statusLines.join("\n"),
    files: allFiles,
    gitRoot: cwd,
    subRepos: repos,
  };
}

export function diffWorkerChanges(
  cwd: string,
  before: GitSnapshot
): { filesChanged: string[]; diffSummary: string; rawDiff: string } {
  const repos = before.subRepos && before.subRepos.length > 0 ? before.subRepos : findGitRepositories(cwd);

  if (repos.length === 0) {
    return {
      filesChanged: [],
      diffSummary: "No git repositories found in workspace",
      rawDiff: "",
    };
  }

  const allFilesChanged: string[] = [];
  const summaryParts: string[] = [];
  let combinedRawDiff = "";

  for (const repo of repos) {
    const relPrefix = repos.length > 1 ? relative(cwd, repo) : "";
    try {
      const statusAfter = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const currentFiles = statusAfter
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => (relPrefix ? `${relPrefix}/${line.slice(3).trim()}` : line.slice(3).trim()));

      const diffStat = execSync("git diff --stat HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const rawDiff = execSync("git diff HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

      if (diffStat) {
        summaryParts.push(relPrefix ? `[${relPrefix}]:\n${diffStat}` : diffStat);
      }
      if (rawDiff) {
        combinedRawDiff += (relPrefix ? `\n# Diff for ${relPrefix}\n` : "") + rawDiff;
      }
      for (const f of currentFiles) {
        if (!allFilesChanged.includes(f)) allFilesChanged.push(f);
      }
    } catch {}
  }

  for (const prev of before.files) {
    if (!allFilesChanged.includes(prev)) allFilesChanged.push(prev);
  }

  return {
    filesChanged: allFilesChanged,
    diffSummary: summaryParts.join("\n\n") || (allFilesChanged.length > 0 ? `${allFilesChanged.length} file(s) untracked or modified` : "No git changes"),
    rawDiff: combinedRawDiff.slice(0, 16000),
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat(git): add multi-repo subfolder discovery and aggregated diff tracking"
```

---

### Task 2: Git Status Cleanliness via `.git/info/exclude` Auto-Registration

**Files:**
- Modify: `src/git.ts`
- Modify: `src/runner.ts`
- Create: `tests/git-exclude.test.ts`

**Interfaces:**
- Consumes: `repoRoot: string`, `entry?: string`
- Produces: `ensureLocalGitExclude(repoRoot: string, entry?: string): boolean`

- [ ] **Step 1: Write test for `.git/info/exclude` auto-registration**

```typescript
// tests/git-exclude.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureLocalGitExclude } from "../src/git.js";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

describe("Git Info Exclude Cleaner", () => {
  const testRepo = join(process.cwd(), "tests", "scratch-exclude-test");

  beforeEach(() => {
    rmSync(testRepo, { recursive: true, force: true });
    mkdirSync(join(testRepo, ".git", "info"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true });
  });

  it("should append .dsh-live.md to .git/info/exclude without duplicating", () => {
    const added1 = ensureLocalGitExclude(testRepo, ".dsh-live.md");
    expect(added1).toBe(true);

    const content1 = readFileSync(join(testRepo, ".git", "info", "exclude"), "utf-8");
    expect(content1).toContain(".dsh-live.md");

    // Second call should be a no-op
    const added2 = ensureLocalGitExclude(testRepo, ".dsh-live.md");
    expect(added2).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/git-exclude.test.ts`
Expected: FAIL (missing `ensureLocalGitExclude`).

- [ ] **Step 3: Implement `ensureLocalGitExclude` in `src/git.ts` and integrate into `src/runner.ts`**

In `src/git.ts`:
```typescript
export function ensureLocalGitExclude(repoRoot: string, entry = ".dsh-live.md"): boolean {
  try {
    const gitDir = join(repoRoot, ".git");
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return false;

    const infoDir = join(gitDir, "info");
    const excludeFile = join(infoDir, "exclude");
    if (!existsSync(infoDir)) {
      mkdirSync(infoDir, { recursive: true });
    }

    let existing = "";
    if (existsSync(excludeFile)) {
      existing = readFileSync(excludeFile, "utf-8");
    }

    const lines = existing.split("\n").map(l => l.trim());
    if (lines.includes(entry)) {
      return false; // Already present
    }

    const updated = existing ? `${existing.trimEnd()}\n${entry}\n` : `${entry}\n`;
    writeFileSync(excludeFile, updated, "utf-8");
    return true;
  } catch {
    return false;
  }
}
```

In `src/runner.ts`:
Before writing `.dsh-live.md`:
```typescript
import { snapshotGit, diffWorkerChanges, findGitRepositories, ensureLocalGitExclude } from "./git.js";

// Inside runDshTask:
const repos = findGitRepositories(cwd);
for (const repo of repos) {
  ensureLocalGitExclude(repo, ".dsh-live.md");
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/git.ts src/runner.ts tests/git-exclude.test.ts
git commit -m "feat(git): auto-register .dsh-live.md in .git/info/exclude to eliminate git status clutter"
```

---

### Task 3: Dynamic Model, Endpoint, & Timeout Overrides in Task Runner

**Files:**
- Modify: `src/types.ts`
- Modify: `src/runner.ts`
- Modify: `src/mcp.ts`
- Create: `tests/runner-options.test.ts`

**Interfaces:**
- Consumes: `DshTaskOptions { cwd, task, model?, endpoint?, apiKey?, profile?, timeoutMs?, verbose? }`
- Produces: Configured subprocess with dynamic model, endpoint, and profile flags.

- [ ] **Step 1: Write test for dynamic option propagation**

```typescript
// tests/runner-options.test.ts
import { describe, it, expect } from "vitest";
import { buildRunnerEnv } from "../src/runner.js";

describe("Runner Option Overrides", () => {
  it("should map task options to standard LLM environment variables", () => {
    const env = buildRunnerEnv({
      cwd: process.cwd(),
      task: "test task",
      model: "qwen-custom:32b",
      endpoint: "http://custom-host:8000/v1",
      apiKey: "custom-token",
    });

    expect(env.DSH_MODEL).toBe("qwen-custom:32b");
    expect(env.OPENAI_MODEL_NAME).toBe("qwen-custom:32b");
    expect(env.OPENAI_BASE_URL).toBe("http://custom-host:8000/v1");
    expect(env.DSH_MODEL_ENDPOINT).toBe("http://custom-host:8000/v1");
    expect(env.OPENAI_API_KEY).toBe("custom-token");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runner-options.test.ts`
Expected: FAIL (`buildRunnerEnv` not exported).

- [ ] **Step 3: Update `src/types.ts` and `src/runner.ts`**

In `src/types.ts`:
```typescript
export interface DshTaskOptions {
  cwd: string;
  task: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  profile?: string;
  timeoutMs?: number;
  verbose?: boolean;
}
```

In `src/runner.ts`:
```typescript
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
```

In `src/mcp.ts`:
Update `dsh_run_task` tool schema:
```typescript
properties: {
  cwd: { type: "string", description: "Absolute path to repository/workspace." },
  task: { type: "string", description: "Clear explicit instructions for the task." },
  model: { type: "string", description: "Optional model override (e.g. qwen2.5-coder:32b, Qwen3.6-35B-A3B-NVFP4)." },
  endpoint: { type: "string", description: "Optional OpenAI-compatible endpoint URL (e.g. http://localhost:11434/v1)." },
  timeoutMs: { type: "number", description: "Max execution time in milliseconds (default: 30 minutes)." },
  verbose: { type: "boolean", description: "Include raw stdout/stderr in output." }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/runner.ts src/mcp.ts tests/runner-options.test.ts
git commit -m "feat(runner): support dynamic model, endpoint, and apiKey overrides in dsh_run_task"
```

---

### Task 4: Active Process Registry & Task Cancellation (`dsh_cancel_task`)

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/mcp.ts`
- Create: `tests/cancellation.test.ts`

**Interfaces:**
- Consumes: `taskId: string`
- Produces: `cancelDshTask(taskId: string): boolean`, `listActiveTasks(): ActiveTaskInfo[]`, MCP tool `dsh_cancel_task`

- [ ] **Step 1: Write unit test for task registration and cancellation**

```typescript
// tests/cancellation.test.ts
import { describe, it, expect } from "vitest";
import { cancelDshTask, listActiveTasks, registerActiveTask, unregisterActiveTask } from "../src/runner.js";

describe("Task Cancellation & Active Registry", () => {
  it("should register, list, and unregister active tasks", () => {
    const mockChild: any = { kill: () => true };
    registerActiveTask("task-123", {
      child: mockChild,
      cwd: "/test/dir",
      task: "test task prompt",
      startTime: Date.now(),
    });

    const active = listActiveTasks();
    expect(active.some(t => t.taskId === "task-123")).toBe(true);

    const cancelled = cancelDshTask("task-123");
    expect(cancelled).toBe(true);

    const after = listActiveTasks();
    expect(after.some(t => t.taskId === "task-123")).toBe(false);
  });

  it("should return false when cancelling non-existent task", () => {
    expect(cancelDshTask("non-existent-task")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cancellation.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement process registry and cancellation in `src/runner.ts` and `src/mcp.ts`**

In `src/runner.ts`:
```typescript
import { ChildProcess } from "child_process";

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
```

In `src/runner.ts` `runDshTask`:
- Call `registerActiveTask(taskId, { child, cwd, task, startTime })`.
- In `child.on("close")` and `child.on("error")`: call `unregisterActiveTask(taskId)`.

In `src/mcp.ts`:
Add `dsh_cancel_task` tool:
```typescript
{
  name: "dsh_cancel_task",
  description: "Terminate an active DeepSeek Harness task process by taskId.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "ID of the task to terminate." },
    },
    required: ["taskId"],
  },
}
```
And handle execution in `CallToolRequestSchema`.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts src/mcp.ts tests/cancellation.test.ts
git commit -m "feat(runner): add active process registry and dsh_cancel_task tool"
```

---

### Task 5: Dedicated Reviewer Tool (`dsh_review_task`)

**Files:**
- Modify: `src/types.ts`
- Create: `src/review.ts`
- Modify: `src/mcp.ts`
- Create: `tests/review.test.ts`

**Interfaces:**
- Consumes: `DshReviewOptions { cwd, brief, diff?, testCommand?, model?, endpoint? }`
- Produces: `runDshReview(options: DshReviewOptions): Promise<DshReviewResult>`, MCP tool `dsh_review_task`

- [ ] **Step 1: Write unit test for the review evaluator**

```typescript
// tests/review.test.ts
import { describe, it, expect } from "vitest";
import { formatReviewPrompt, parseReviewVerdict } from "../src/review.js";

describe("Review Engine", () => {
  it("should generate a structured review prompt incorporating brief and diff", () => {
    const prompt = formatReviewPrompt({
      cwd: "/test/dir",
      brief: "Refactor auth middleware to JWT",
      diff: "diff --git a/auth.ts b/auth.ts\n+ jwt.verify(token)",
      testCommand: "npm test",
    });

    expect(prompt).toContain("Refactor auth middleware to JWT");
    expect(prompt).toContain("jwt.verify(token)");
    expect(prompt).toContain("npm test");
  });

  it("should parse structured JSON verdict cleanly", () => {
    const jsonOutput = JSON.stringify({
      verdict: "APPROVED",
      summary: "Clean implementation matching all requirements.",
      specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
      qualityAudit: { issues: [], strengths: ["Solid error handling"] },
    });

    const parsed = parseReviewVerdict(jsonOutput);
    expect(parsed.verdict).toBe("APPROVED");
    expect(parsed.specCompliance.compliant).toBe(true);
  });

  it("should fall back gracefully if model returns unstructured text with APPROVED", () => {
    const textOutput = "Everything looks great. The implementation is [APPROVED].";
    const parsed = parseReviewVerdict(textOutput);
    expect(parsed.verdict).toBe("APPROVED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review.test.ts`
Expected: FAIL (missing `src/review.ts`).

- [ ] **Step 3: Implement `src/review.ts` and register `dsh_review_task` in `src/mcp.ts`**

In `src/types.ts`:
```typescript
export interface DshReviewOptions {
  cwd: string;
  brief: string;
  diff?: string;
  testCommand?: string;
  model?: string;
  endpoint?: string;
}

export interface DshReviewResult {
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

In `src/review.ts`:
```typescript
import { execSync } from "child_process";
import http from "http";
import https from "https";
import { diffWorkerChanges, snapshotGit } from "./git.js";
import type { DshReviewOptions, DshReviewResult } from "./types.js";

export function formatReviewPrompt(options: DshReviewOptions): string {
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

export function parseReviewVerdict(rawText: string): DshReviewResult {
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

export async function runDshReview(options: DshReviewOptions): Promise<DshReviewResult> {
  const { cwd, brief, testCommand } = options;

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

  // 3. Connect to local/free model endpoint
  const endpoint = options.endpoint || process.env.DSH_MODEL_ENDPOINT || process.env.OPENAI_BASE_URL || "http://localhost:11434/v1";
  const model = options.model || process.env.DSH_MODEL || process.env.OPENAI_MODEL_NAME || "qwen2.5-coder:32b";
  const prompt = formatReviewPrompt({ ...options, diff: effectiveDiff });

  let reviewResponse = "";
  try {
    const isHttps = endpoint.startsWith("https://");
    const client = isHttps ? https : http;
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    const parsedUrl = new URL(`${endpoint.replace(/\/+$/, "")}/chat/completions`);
    reviewResponse = await new Promise<string>((resolve, reject) => {
      const req = client.request(
        parsedUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}),
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
    reviewResponse = `[Auto-Fallback]: Review connection to ${endpoint} failed (${err.message}). Defaulting to manual verification check.`;
  }

  const result = parseReviewVerdict(reviewResponse);
  result.diffInspected = effectiveDiff.slice(0, 4000);
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

In `src/mcp.ts`:
Register `dsh_review_task` in `TOOLS` and wire it up in `CallToolRequestSchema`.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/review.ts src/mcp.ts tests/review.test.ts
git commit -m "feat(review): introduce native dsh_review_task tool for automated dual-agent QA verification"
```

---

### Task 6: Antigravity Config Synchronization & Live Health Verification

**Files:**
- Modify: `scripts/setup.sh`
- Verify: `~/.gemini/config/mcp_config.json`

**Interfaces:**
- Consumes: Existing Antigravity config
- Produces: Updated `mcp_config.json` pointing to `git-personal/dsh-agent-mcp/build/mcp.js` and confirmed healthy via `dsh_doctor`.

- [ ] **Step 1: Update `scripts/setup.sh` to offer automatic update of `mcp_config.json`**

In `scripts/setup.sh`:
```bash
# Update Antigravity mcp_config.json automatically if present
MCP_CONFIG="${HOME}/.gemini/config/mcp_config.json"
if [ -f "${MCP_CONFIG}" ]; then
  echo "🔧 Updating Antigravity MCP config to point to this dsh-agent-mcp build..."
  node -e "
    const fs = require('fs');
    const p = '${MCP_CONFIG}';
    const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers.dsh = {
      command: 'node',
      args: ['${MCP_SERVER_PATH}'],
      env: {
        DSH_MODEL_ENDPOINT: 'http://localhost:11434/v1',
        DSH_MODEL: 'qwen2.5-coder:32b'
      }
    };
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
  "
  echo "✅ Updated ${MCP_CONFIG} with active build path."
fi
```

- [ ] **Step 2: Execute `scripts/setup.sh` and verify build**

Run: `./scripts/setup.sh`
Expected: Clean execution, update of `mcp_config.json`, build exit 0.

- [ ] **Step 3: Run full verification suite**

Run: `npm test && npm run doctor`
Expected: 100% test pass rate.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/setup.sh
git commit -m "feat(setup): auto-update Antigravity mcp_config.json to point to active repository build"
git push origin main
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-24-dsh-agent-mcp-v2-upgrades.md`.
