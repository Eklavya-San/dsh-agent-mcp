# Pi Agent MCP Web UI & Live Worker Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a zero-dependency local Web UI on **port 7081** for `pi-agent-mcp` with a real-time Live Worker Dashboard (SSE streaming logs, elapsed runtime, and one-click task cancellation) and visual Pi model configuration (discovering and managing all providers/logins from `~/.pi/agent/models.json` and `settings.json`).

**Architecture:** 
- `src/pi-config.ts` reads and updates `~/.pi/agent/models.json`, `auth.json`, and `settings.json`, exposing all models dynamically to `src/providers.ts`.
- `src/web.ts` runs a native Node.js HTTP server on port `7081` with REST endpoints (`/api/status`, `/api/config`, `/api/cancel`, `/api/test-provider`) and an SSE endpoint (`/api/events`) for live terminal streaming.
- `src/web-html.ts` contains the embedded single-page responsive dark-mode dashboard (Obsidian / Tailwind styling).
- Companion daemon controls (`startWebUi`, `stopWebUi`, `getWebStatus`) and MCP tools (`pi_web_start`, `pi_web_status`, `pi_web_stop`) in `src/mcp.ts`.

**Tech Stack:** TypeScript (ES2022, NodeNext), Node.js (>=20, native `http`), Server-Sent Events (SSE), Vitest, Tailwind CSS (via CDN).

## Global Constraints

- Must run on Node.js >= 20.0.0 without external native binaries or new npm dependencies (zero extra npm packages).
- Default port must be `7081` (configurable via `PI_WEB_PORT` or `--port 7081`).
- Dynamically discovers all existing models and provider logins in `~/.pi/agent/` without restricting to static presets.
- 100% test pass rate with 0 test timeouts before publishing.

---

### Task 1: Pi Configuration Discovery & Model Sync Engine (`src/pi-config.ts`)

**Files:**
- Create: `src/pi-config.ts`
- Modify: `src/providers.ts`
- Create: `tests/pi-config.test.ts`

**Interfaces:**
- Consumes: `~/.pi/agent/models.json`, `~/.pi/agent/auth.json`, `~/.pi/agent/settings.json`.
- Produces:
  - `loadPiConfig(): PiAgentConfig`
  - `savePiProvider(providerId: string, config: any): void`
  - `setPiDefaultModel(providerId: string, modelId: string): void`
  - Dynamic provider and model resolution in `src/providers.ts`.

- [ ] **Step 1: Write tests for Pi config loader and sync**

```typescript
// tests/pi-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { loadPiConfigFromDir, savePiProviderToDir, setPiDefaultModelInDir } from "../src/pi-config.js";

describe("Pi Configuration Discovery", () => {
  const testDir = join(process.cwd(), "tests", "scratch-pi-config");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    writeFileSync(
      join(testDir, "models.json"),
      JSON.stringify({
        providers: {
          freetoken: {
            name: "FreeToken Qwen",
            baseUrl: "http://machinewiseapp.in:10346/v1",
            apiKey: "free-token",
            models: [{ id: "Qwen3.6-35B-A3B-NVFP4", name: "Qwen 35B" }],
          },
          ollama: {
            name: "Local Ollama",
            baseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [{ id: "qwen2.5-coder:32b", name: "Qwen Coder" }],
          },
        },
      }),
      "utf-8"
    );

    writeFileSync(
      join(testDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "freetoken",
        defaultModel: "Qwen3.6-35B-A3B-NVFP4",
      }),
      "utf-8"
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should load all providers and models from pi config directory", () => {
    const config = loadPiConfigFromDir(testDir);
    expect(config.defaultProvider).toBe("freetoken");
    expect(config.defaultModel).toBe("Qwen3.6-35B-A3B-NVFP4");
    expect(config.providers.length).toBe(2);
    expect(config.providers.some(p => p.id === "freetoken")).toBe(true);
    expect(config.providers.some(p => p.id === "ollama")).toBe(true);
  });

  it("should update default model in settings.json", () => {
    setPiDefaultModelInDir(testDir, "ollama", "qwen2.5-coder:32b");
    const updated = loadPiConfigFromDir(testDir);
    expect(updated.defaultProvider).toBe("ollama");
    expect(updated.defaultModel).toBe("qwen2.5-coder:32b");
  });

  it("should add a new custom provider to models.json", () => {
    savePiProviderToDir(testDir, "vllm", {
      name: "Local vLLM",
      baseUrl: "http://localhost:8000/v1",
      apiKey: "token",
      models: [{ id: "deepseek-coder", name: "DeepSeek Coder" }],
    });

    const updated = loadPiConfigFromDir(testDir);
    expect(updated.providers.some(p => p.id === "vllm")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pi-config.test.ts`
Expected: FAIL (`pi-config.js` not found).

- [ ] **Step 3: Implement `src/pi-config.ts` and update `src/providers.ts`**

In `src/pi-config.ts`:
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { ProviderConfig } from "./types.js";

export interface PiModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface PiProviderDetail extends ProviderConfig {
  models: PiModelInfo[];
}

export interface PiAgentConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: PiProviderDetail[];
}

export function getDefaultPiAgentDir(): string {
  return join(homedir(), ".pi", "agent");
}

export function loadPiConfigFromDir(dirPath: string): PiAgentConfig {
  const modelsPath = join(dirPath, "models.json");
  const settingsPath = join(dirPath, "settings.json");
  const authPath = join(dirPath, "auth.json");

  let authKeys: Record<string, string> = {};
  if (existsSync(authPath)) {
    try {
      authKeys = JSON.parse(readFileSync(authPath, "utf-8"));
    } catch {}
  }

  let defaultProvider = process.env.PI_DEFAULT_PROVIDER || "freetoken";
  let defaultModel = process.env.PI_DEFAULT_MODEL || "Qwen3.6-35B-A3B-NVFP4";

  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (settings.defaultProvider) defaultProvider = settings.defaultProvider;
      if (settings.defaultModel) defaultModel = settings.defaultModel;
    } catch {}
  }

  const providers: PiProviderDetail[] = [];

  if (existsSync(modelsPath)) {
    try {
      const data = JSON.parse(readFileSync(modelsPath, "utf-8"));
      const provs = data.providers || {};
      for (const [id, prov] of Object.entries<any>(provs)) {
        const apiKey = authKeys[id] || prov.apiKey;
        const models: PiModelInfo[] = Array.isArray(prov.models)
          ? prov.models.map((m: any) => ({
              id: m.id || m.name,
              name: m.name || m.id,
              contextWindow: m.contextWindow,
              reasoning: m.reasoning,
            }))
          : [];

        providers.push({
          id,
          name: prov.name || id,
          baseUrl: prov.baseUrl || "",
          defaultModel: models[0]?.id || "",
          apiKey,
          models,
        });
      }
    } catch {}
  }

  // Fallback defaults if models.json is empty or missing
  if (providers.length === 0) {
    providers.push(
      {
        id: "freetoken",
        name: "FreeToken Qwen Cluster ($0 cost)",
        baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
        defaultModel: "Qwen3.6-35B-A3B-NVFP4",
        apiKey: "free-token",
        models: [{ id: "Qwen3.6-35B-A3B-NVFP4", name: "Qwen 3.6 35B FP4" }],
      },
      {
        id: "ollama",
        name: "Local Ollama",
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        defaultModel: "qwen2.5-coder:32b",
        models: [{ id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B" }],
      }
    );
  }

  return {
    defaultProvider,
    defaultModel,
    providers,
  };
}

export function loadPiConfig(): PiAgentConfig {
  return loadPiConfigFromDir(getDefaultPiAgentDir());
}

export function setPiDefaultModelInDir(dirPath: string, providerId: string, modelId: string): void {
  const settingsPath = join(dirPath, "settings.json");
  mkdirSync(dirPath, { recursive: true });

  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {}
  }

  settings.defaultProvider = providerId;
  settings.defaultModel = modelId;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

export function setPiDefaultModel(providerId: string, modelId: string): void {
  setPiDefaultModelInDir(getDefaultPiAgentDir(), providerId, modelId);
}

export function savePiProviderToDir(dirPath: string, providerId: string, config: any): void {
  const modelsPath = join(dirPath, "models.json");
  mkdirSync(dirPath, { recursive: true });

  let data: any = { providers: {} };
  if (existsSync(modelsPath)) {
    try {
      data = JSON.parse(readFileSync(modelsPath, "utf-8"));
      data.providers = data.providers || {};
    } catch {}
  }

  data.providers[providerId] = {
    name: config.name || providerId,
    baseUrl: config.baseUrl,
    api: "openai-completions",
    apiKey: config.apiKey,
    models: config.models || [{ id: config.defaultModel || providerId, name: config.name || providerId }],
  };

  writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf-8");
}

export function savePiProvider(providerId: string, config: any): void {
  savePiProviderToDir(getDefaultPiAgentDir(), providerId, config);
}
```

In `src/providers.ts`:
Update `getProviders()` to integrate `loadPiConfig()` so dynamically loaded models and providers from Pi are returned automatically, while preserving static fallbacks.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/pi-config.test.ts tests/providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pi-config.ts src/providers.ts tests/pi-config.test.ts
git commit -m "feat(config): implement dynamic Pi model and provider discovery engine"
```

---

### Task 2: Native HTTP Server & REST API Endpoints on Port 7081 (`src/web.ts`)

**Files:**
- Modify: `src/web.ts`
- Create: `tests/web-server.test.ts`

**Interfaces:**
- Native Node HTTP server listening on port `7081`.
- Endpoints:
  - `GET /api/status`: returns `{ running: true, port: 7081, activeTasks: [...], doctor: ... }`
  - `GET /api/config`: returns Pi providers, models, default model
  - `POST /api/config`: updates provider or default model in `~/.pi/agent/`
  - `POST /api/cancel`: cancels active task via `cancelPiTask(taskId)`
  - `POST /api/test-provider`: tests URL reachability & latency

- [ ] **Step 1: Write tests for HTTP REST endpoints**

```typescript
// tests/web-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { createWebServer } from "../src/web.js";

describe("Web Server REST API", () => {
  let server: http.Server;
  let testPort: number;

  beforeAll(async () => {
    server = createWebServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        testPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should return status on GET /api/status", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.running).toBe(true);
    expect(Array.isArray(data.activeTasks)).toBe(true);
  });

  it("should return config on GET /api/config", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.defaultProvider).toBeDefined();
  });

  it("should handle task cancellation on POST /api/cancel", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "non-existent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cancelled).toBe(false);
  });

  it("should test provider reachability on POST /api/test-provider", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/test-provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://httpbin.org/status/200" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.latencyMs).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web-server.test.ts`
Expected: FAIL (`createWebServer` not implemented).

- [ ] **Step 3: Implement HTTP REST endpoints in `src/web.ts`**

In `src/web.ts`:
- Define `DEFAULT_PORT = 7081`.
- Implement `createWebServer()`:
  - Handles CORS and JSON parsing.
  - Routes `GET /api/status`: calls `listActiveTasks()` and `checkPiInstalled()`.
  - Routes `GET /api/config`: calls `loadPiConfig()`.
  - Routes `POST /api/config`: saves changes via `setPiDefaultModel` or `savePiProvider`.
  - Routes `POST /api/cancel`: calls `cancelPiTask(body.taskId)`.
  - Routes `POST /api/test-provider`: tests URL with timeout.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/web-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web.ts tests/web-server.test.ts
git commit -m "feat(web): implement native HTTP server on port 7081 with REST endpoints"
```

---

### Task 3: Real-Time Event Bus & Server-Sent Events (SSE) Streaming

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/web.ts`
- Create: `tests/web-events.test.ts`

**Interfaces:**
- Event bus: `taskEvents.emit("event", data)`.
- SSE Endpoint: `GET /api/events` (Content-Type: `text/event-stream`).

- [ ] **Step 1: Write test for SSE stream**

```typescript
// tests/web-events.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { createWebServer, emitTaskEvent } from "../src/web.js";

describe("Web Server SSE Event Streaming", () => {
  let server: http.Server;
  let testPort: number;

  beforeAll(async () => {
    server = createWebServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        testPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should stream events over GET /api/events", async () => {
    const events: string[] = [];

    const req = http.get(`http://127.0.0.1:${testPort}/api/events`, (res) => {
      expect(res.headers["content-type"]).toBe("text/event-stream");
      res.on("data", (chunk) => {
        events.push(chunk.toString());
      });
    });

    await new Promise((r) => setTimeout(r, 200));
    emitTaskEvent({ type: "test_event", message: "hello" });
    await new Promise((r) => setTimeout(r, 200));

    req.destroy();
    expect(events.some((e) => e.includes("hello"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web-events.test.ts`
Expected: FAIL (`emitTaskEvent` not exported or `/api/events` not implemented).

- [ ] **Step 3: Implement EventEmitter & SSE in `src/web.ts` and wire with `src/runner.ts`**

In `src/web.ts`:
- Create `const taskEvents = new EventEmitter();`
- Export `emitTaskEvent(event: any): void`
- In `createWebServer`:
  - Route `GET /api/events`:
    - Set headers:
      ```javascript
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      ```
    - Send initial state: `res.write(`data: ${JSON.stringify({ type: "init", activeTasks: listActiveTasks() })}\n\n`);`
    - Listen to `taskEvents.on("event", onEvent)` and write to `res`.
    - Clean up listener on `req.on("close")`.

In `src/runner.ts`:
- Import `emitTaskEvent` from `./web.js`.
- Emit events in `runPiTask`:
  - `task_started`: `{ taskId, cwd, task }`
  - `log_delta`: `{ taskId, delta }`
  - `task_finished`: `{ taskId, status, durationMs, filesChanged }`

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run tests/web-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts src/web.ts tests/web-events.test.ts
git commit -m "feat(web): add real-time event bus and Server-Sent Events (SSE) streaming"
```

---

### Task 4: Obsidian Dark-Mode Dashboard Frontend (`src/web-html.ts`)

**Files:**
- Create: `src/web-html.ts`
- Modify: `src/web.ts`

**Interfaces:**
- `getDashboardHtml(): string` returned at `GET /`.

- [ ] **Step 1: Implement `src/web-html.ts`**

Features inside single-file HTML/JS/Tailwind bundle:
1. **Header**:
   - `pi-agent-mcp` branding + live connection badge (`Online on Port 7081`).
   - Quick stats: Active Workers count, Total Providers, Default Model badge.
2. **Tab Navigation**:
   - Tab 1: **Live Workers & Logs** (active task list, live terminal stream, cancel button, history).
   - Tab 2: **Pi & MCP Configuration** (providers from `models.json`, base URLs, model IDs, test ping buttons, set default).
   - Tab 3: **Doctor Diagnostics** (live health report).
3. **Real-time Client Script**:
   - `const es = new EventSource("/api/events");`
   - Dynamically updates active tasks, timer clocks, and terminal stream output without page reload.
   - "Abort Worker" button calls `fetch("/api/cancel", { method: "POST", body: JSON.stringify({ taskId }) })`.
   - "Test Ping" button calls `/api/test-provider` and updates latency badges (`🟢 42ms`).
   - "Set as Default" calls `/api/config` and displays toast notification.

- [ ] **Step 2: Serve HTML at `GET /` in `src/web.ts`**

In `src/web.ts`:
```typescript
import { getDashboardHtml } from "./web-html.js";

// Inside request handler:
if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(getDashboardHtml());
  return;
}
```

- [ ] **Step 3: Run existing tests to verify server returns HTML on `GET /`**

Run: `npx vitest run tests/web-server.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web-html.ts src/web.ts
git commit -m "feat(web): build obsidian dark-mode dashboard with live terminal streaming and config editor"
```

---

### Task 5: Web UI Companion Daemon Management & MCP Tools

**Files:**
- Modify: `src/web.ts`
- Modify: `src/mcp.ts`
- Modify: `package.json`
- Create: `tests/web-daemon.test.ts`

**Interfaces:**
- Functions: `getWebStatus(port?: number): Promise<PiWebStatus>`, `startWebUi(port?: number): Promise<PiWebStatus>`, `stopWebUi(port?: number): Promise<{ stopped: boolean; message: string }>`.
- MCP Tools in `src/mcp.ts`:
  - `pi_web_start`: starts web daemon on port 7081.
  - `pi_web_status`: inspects port 7081.
  - `pi_web_stop`: stops web daemon.
- `package.json`: `"scripts": { "web": "node build/web.js" }`.

- [ ] **Step 1: Write tests for daemon lifecycle**

```typescript
// tests/web-daemon.test.ts
import { describe, it, expect } from "vitest";
import { getWebStatus } from "../src/web.js";

describe("Web Companion Daemon", () => {
  it("should return web status object with port and running boolean", async () => {
    const status = await getWebStatus(7081);
    expect(typeof status.running).toBe("boolean");
    expect(status.port).toBe(7081);
    expect(status.url).toContain("7081");
  });
});
```

- [ ] **Step 2: Run test to verify it passes or fails**

Run: `npx vitest run tests/web-daemon.test.ts`
Expected: PASS.

- [ ] **Step 3: Implement `startWebUi`, `stopWebUi`, and wire MCP tools in `src/mcp.ts`**

In `src/web.ts`:
- Implement `startWebUi(port = 7081)` using detached spawn of `node build/web.js --port <port>`.
- Implement `stopWebUi(port = 7081)` using `lsof` PID lookup and `process.kill`.
- Add CLI entrypoint at bottom:
  ```typescript
  if (process.argv[1] && process.argv[1].endsWith("web.js")) {
    const port = parseInt(process.env.PI_WEB_PORT || "7081", 10);
    const server = createWebServer();
    server.listen(port, "0.0.0.0", () => {
      process.stderr.write(`Pi Agent Web Dashboard running on http://127.0.0.1:${port}\n`);
    });
  }
  ```

In `src/mcp.ts`:
- Add `pi_web_start`, `pi_web_status`, `pi_web_stop` to `TOOLS`.
- Wire in `CallToolRequestSchema` handlers.

- [ ] **Step 4: Run full test suite and verify build**

Run: `npm run build && npm test`
Expected: 100% tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/web.ts src/mcp.ts package.json tests/web-daemon.test.ts
git commit -m "feat(web): add daemon management, CLI runner, and pi_web_* MCP tools"
```

---

### Task 6: Setup Script, Antigravity Sync & End-to-End Verification

**Files:**
- Modify: `scripts/setup.sh`
- Modify: `README.md`

**Interfaces:**
- `./scripts/setup.sh` automatically compiles, informs user of `http://localhost:7081`, and registers all tools.

- [ ] **Step 1: Update `scripts/setup.sh` and documentation**

In `scripts/setup.sh`:
- Announce Web UI companion at `http://127.0.0.1:7081`.
- Provide `npm run web` instructions.

In `README.md`:
- Document the Web UI features, port 7081, live terminal streaming, and provider management.

- [ ] **Step 2: Execute `./scripts/setup.sh` and boot the server**

Run: `./scripts/setup.sh`
Expected: Clean build, configurations synchronized.

- [ ] **Step 3: Run full verification suite**

Run: `npm run build && npm test && npm run doctor`
Expected:
- Clean build exit 0.
- All tests pass (100%).
- Doctor returns `HEALTHY`.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/setup.sh README.md
git commit -m "feat(setup): add Web UI companion documentation and sync on port 7081"
git push origin main
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-30-pi-agent-mcp-web-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
