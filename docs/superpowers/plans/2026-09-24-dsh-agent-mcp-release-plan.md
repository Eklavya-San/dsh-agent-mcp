# dsh-agent-mcp Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `dsh-agent-mcp` into an enterprise-grade, fully tested, open-source GitHub repository and npm package ready for public distribution and community adoption.

**Architecture:** Add automated unit & integration test suites using Vitest, add GitHub Actions CI/CD workflows for multi-platform validation, enhance git detection for monorepos, add an automated one-command interactive installer (`setup.sh`), and verify end-to-end tool execution against local backends (Ollama/FreeToken).

**Tech Stack:** TypeScript (ES2022, NodeNext), Node.js (>=20), @modelcontextprotocol/sdk, Vitest, GitHub Actions, DeepSeek Harness (@deepseek-ai/dsh).

## Global Constraints

- Must run on Node.js >= 20.0.0 without external native binaries.
- Zero paid API token dependencies required to run tests or local tasks.
- Must support monorepos and subdirectories where `.git` is in a parent directory.
- All MCP tools must return valid MCP content objects with structured JSON.
- 100% test pass rate in CI before publishing.

---

### Task 1: Test Suite Setup & Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `tests/setup.ts`

**Interfaces:**
- Consumes: `npm test` script in `package.json`
- Produces: Vitest test runner configuration supporting NodeNext ESM imports and mock timers.

- [ ] **Step 1: Install Vitest dev dependency**
```bash
npm install -D vitest @types/node
```

- [ ] **Step 2: Create Vitest configuration**
```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
```

- [ ] **Step 3: Update `package.json` with test scripts**
```json
"scripts": {
  "build": "tsc",
  "start": "node build/mcp.js",
  "doctor": "node build/doctor.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepare": "npm run build"
}
```

- [ ] **Step 4: Verify test runner executes**
Run: `npm test`
Expected: Output showing Vitest running with 0 test files found.

- [ ] **Step 5: Commit**
```bash
git add package.json vitest.config.ts package-lock.json
git commit -m "chore: setup vitest testing framework"
```

---

### Task 2: Git Engine & Monorepo Traversal Unit Tests

**Files:**
- Modify: `src/git.ts`
- Create: `tests/git.test.ts`

**Interfaces:**
- Consumes: `snapshotGit(cwd: string)`, `diffWorkerChanges(cwd: string, before: GitSnapshot)`
- Produces: Resilient git detection that traverses up parent directories to find git root if `cwd` is a subpackage or monorepo workspace.

- [ ] **Step 1: Write unit test for git root traversal**
```typescript
// tests/git.test.ts
import { describe, it, expect } from "vitest";
import { snapshotGit, diffWorkerChanges } from "../src/git.js";
import { join } from "path";

describe("Git Engine", () => {
  it("should capture git commit hash and status in a valid git repo", () => {
    const snapshot = snapshotGit(process.cwd());
    expect(snapshot.commit).toBeDefined();
    expect(snapshot.commit).not.toBe("unknown");
    expect(Array.isArray(snapshot.files)).toBe(true);
  });

  it("should handle non-git directory gracefully without throwing", () => {
    const snapshot = snapshotGit("/tmp");
    expect(snapshot.commit).toBe("unknown");
    expect(snapshot.status).toBe("");
    expect(snapshot.files).toEqual([]);
  });

  it("should calculate diff correctly without throwing", () => {
    const before = snapshotGit(process.cwd());
    const result = diffWorkerChanges(process.cwd(), before);
    expect(result.diffSummary).toBeDefined();
    expect(Array.isArray(result.filesChanged)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify behavior**
Run: `npm test`
Expected: Tests pass or highlight missing directory root handling.

- [ ] **Step 3: Enhance `src/git.ts` to locate repository root**
```typescript
// src/git.ts
import { execSync } from "child_process";

export interface GitSnapshot {
  commit: string;
  status: string;
  files: string[];
  gitRoot?: string;
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

export function snapshotGit(cwd: string): GitSnapshot {
  const root = findGitRoot(cwd) || cwd;
  try {
    const commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const files = status
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice(3).trim());

    return { commit, status, files, gitRoot: root };
  } catch {
    return { commit: "unknown", status: "", files: [], gitRoot: undefined };
  }
}
```

- [ ] **Step 4: Run test to verify all pass**
Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**
```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat(git): add git root detection and monorepo traversal tests"
```

---

### Task 3: Doctor & Session Inspector Unit Tests

**Files:**
- Create: `tests/doctor.test.ts`
- Create: `tests/sessions.test.ts`
- Modify: `src/doctor.ts`

**Interfaces:**
- Consumes: `runDshDoctor()`, `listSessions()`, `countRecentSessions()`
- Produces: Validated diagnostic reports and session history listings.

- [ ] **Step 1: Write test for session discovery**
```typescript
// tests/sessions.test.ts
import { describe, it, expect } from "vitest";
import { countRecentSessions, listSessions, getDshSessionsDir } from "../src/sessions.js";

describe("Sessions Discovery", () => {
  it("should return valid path for dsh sessions directory", () => {
    const dir = getDshSessionsDir();
    expect(dir).toContain(".dsh");
    expect(dir).toContain("sessions");
  });

  it("should return a number for recent sessions count", () => {
    const count = countRecentSessions();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEl(0);
  });

  it("should return an array of session records", () => {
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
```

- [ ] **Step 2: Write test for doctor health check**
```typescript
// tests/doctor.test.ts
import { describe, it, expect } from "vitest";
import { runDshDoctor } from "../src/doctor.js";

describe("DSH Doctor", () => {
  it("should return structured health report", async () => {
    const report = await runDshDoctor();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.status);
    expect(report.dshBinary).toBeDefined();
    expect(typeof report.dshBinary.installed).toBe("boolean");
    expect(report.settings).toBeDefined();
    expect(report.modelEndpoint).toBeDefined();
    expect(report.webUi).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests and verify**
Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 4: Commit**
```bash
git add tests/sessions.test.ts tests/doctor.test.ts
git commit -m "test: add doctor and session inspector unit tests"
```

---

### Task 4: GitHub Actions CI/CD Automation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: Push to `main` branch, Pull Requests, Git Release tags (`v*.*.*`)
- Produces: Automated lint, typecheck, multi-OS build matrix (Ubuntu, macOS), and npm automated publishing.

- [ ] **Step 1: Create CI workflow**
```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node-version: [20.x, 22.x]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build TypeScript
        run: npm run build

      - name: Run Test Suite
        run: npm test
```

- [ ] **Step 2: Create automated npm publish workflow**
```yaml
# .github/workflows/publish.yml
name: Publish to NPM

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 3: Verify workflow syntax**
Ensure paths and yaml formatting are valid.

- [ ] **Step 4: Commit**
```bash
git add .github/workflows/ci.yml .github/workflows/publish.yml
git commit -m "ci: add GitHub Actions matrix test and npm publish workflows"
```

---

### Task 5: 1-Command Automated Installer (`setup.sh`)

**Files:**
- Create: `scripts/setup.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: User executing `curl -fsSL ... | bash` or `./scripts/setup.sh`
- Produces: Automatically detects Antigravity, Claude Desktop, Cursor, or Cline on the host machine and registers the MCP server configuration into the proper JSON configuration file.

- [ ] **Step 1: Write `setup.sh`**
```bash
#!/usr/bin/env bash
# setup.sh: Interactive 1-command installer for dsh-agent-mcp

set -e

echo "🚀 Installing dsh-agent-mcp..."

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required. Please install Node.js >= 20."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️ Warning: Node.js version is < 20 (detected v$NODE_VERSION)."
fi

# 2. Build local repository if in source directory
if [ -f "package.json" ]; then
  echo "📦 Building dsh-agent-mcp from source..."
  npm install
  npm run build
fi

echo "✅ dsh-agent-mcp ready for configuration."
```

- [ ] **Step 2: Make executable and test**
Run: `chmod +x scripts/setup.sh && ./scripts/setup.sh`
Expected: Clean execution exit code 0.

- [ ] **Step 3: Commit**
```bash
git add scripts/setup.sh
git commit -m "feat(installer): add automated setup.sh script"
```

---

### Task 6: GitHub Remote Setup & Initial Push

**Files:**
- Repository: `/Users/eklavya/git-personal/dsh-agent-mcp`

**Interfaces:**
- Consumes: GitHub CLI (`gh`) or git remote origin URL
- Produces: Live public repository on GitHub

- [ ] **Step 1: Check GitHub authentication**
Run: `gh auth status`

- [ ] **Step 2: Create public GitHub repository and push**
```bash
gh repo create dsh-agent-mcp --public --source=. --push --description "Model Context Protocol (MCP) server connecting Antigravity, Claude, and Cursor to DeepSeek Harness for \$0-cost autonomous coding and dual-agent verification."
```

- [ ] **Step 3: Verify repository URL and clone availability**
Check repo page on GitHub and verify badges render properly.
