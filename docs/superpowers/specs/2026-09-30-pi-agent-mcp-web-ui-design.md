# Pi Agent MCP Web UI & Live Worker Monitor (Port 7081) Design Document

- **Date:** 2026-09-30
- **Author:** Antigravity & User Pair Programming
- **Status:** Approved / Ready for Implementation
- **Target Repository:** `/Users/eklavya/git-personal/dsh-agent-mcp` (`pi-agent-mcp`)
- **Default Port:** `7081`

---

## 1. Executive Summary & Goals

This project implements a dedicated, zero-dependency Web UI dashboard on **port 7081** for `pi-agent-mcp`. The dashboard serves two primary purposes:
1. **Live Active Worker Monitor**: Real-time visibility into active Pi coding workers, displaying runtime duration, task briefs, active workspace paths, live streaming terminal output (via Server-Sent Events / SSE), and an instant "Abort / Cancel Worker" kill switch.
2. **Dynamic MCP & Pi Model Configuration**: Full visual management of all inference providers and model logins stored in `~/.pi/agent/models.json`, `auth.json`, and `settings.json`. Discovers any models already configured in Pi (FreeToken, NVIDIA NIM, Ollama, OpenRouter, Anthropic, OpenAI, custom endpoints), allows testing connectivity and latency via live pings, and allows setting the default provider and model.

---

## 2. Architecture & Components

```
┌─────────────────────────────────────────────────────────────┐
│                 Browser (http://localhost:7081)              │
│  - Live Active Workers & Terminal Output Streaming (SSE)   │
│  - Task Cancellation & History Audit                        │
│  - Dynamic Pi Model Configuration & Connection Ping Tests   │
└──────────────────────────────┬──────────────────────────────┘
                               │ (HTTP & SSE)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             pi-agent-mcp Web Server (src/web.ts)            │
│  - GET  /                  -> Serves responsive Obsidian UI │
│  - GET  /api/status        -> Active workers, doctor report │
│  - GET  /api/events        -> Server-Sent Events (SSE) logs │
│  - POST /api/cancel        -> Calls cancelPiTask(taskId)    │
│  - GET  /api/config        -> Reads ~/.pi/agent/models.json │
│  - POST /api/config        -> Updates ~/.pi/agent configs   │
│  - POST /api/test-provider -> Runs live health ping on URL  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
        ┌─────────────────────────────────────────────┐
        │        Internal Core Engine Modules         │
        │  - src/runner.ts   (listActiveTasks/cancel) │
        │  - src/providers.ts (dynamic Pi models sync)│
        │  - src/doctor.ts   (runPiDoctor)            │
        │  - ~/.pi/agent/    (models.json/settings)   │
        └─────────────────────────────────────────────┘
```

### Component Breakdown

1. **`src/web.ts` (HTTP & SSE Server)**:
   - Built on native Node.js `http` module with zero extra npm dependencies.
   - Defaults to port `7081` (configurable via `PI_WEB_PORT` or CLI `--port`).
   - Serves an embedded, responsive dark-mode HTML/Tailwind SPA.
   - Provides REST endpoints (`/api/status`, `/api/config`, `/api/cancel`, `/api/test-provider`).
   - Streams live task logs and lifecycle events via Server-Sent Events (`/api/events`).
2. **`src/pi-config.ts` (Dynamic Pi Config Resolver)**:
   - Reads directly from `~/.pi/agent/models.json`, `auth.json`, and `settings.json`.
   - Discovers all user-configured providers and models.
   - Provides functions to write/persist updated provider definitions and default model selections.
   - Gracefully falls back to environment variables if `~/.pi/agent/` files are not found.
3. **`src/providers.ts`**:
   - Integrates with `src/pi-config.ts` so `resolveProvider()` and `listProviders()` dynamically reflect all Pi models in real time.
4. **`src/mcp.ts` (Companion MCP Tools)**:
   - Exposes:
     - `pi_web_start`: Launches the companion Web UI daemon in background detached mode on port `7081`.
     - `pi_web_status`: Checks whether the Web UI is currently running, returns PID, URL, and active task count.
     - `pi_web_stop`: Gracefully terminates the running Web UI process.

---

## 3. UI Features & Layout

### 3.1 Live Workers Panel
- **Active Task Cards**:
  - Task ID, workspace path (`cwd`), architect prompt brief.
  - Active model tag (e.g. `FreeToken / Qwen3.6-35B-A3B-NVFP4`).
  - Live duration timer (`MM:SS`) updated in real-time.
  - One-click **"Abort Worker"** button invoking `POST /api/cancel`.
- **Live Terminal Log Streamer**:
  - Embedded console viewer showing streaming log deltas from `.pi-live.md`.
  - ANSI/Markdown styling for `💭 Thinking`, `⚙️ [tool]`, and `✔️ Output`.
  - Auto-scroll lock with manual scroll override.
- **Recent Task History**:
  - Expandable history table with duration, timestamp, status (`SUCCESS`, `FAILED`, `TIMED_OUT`), and git diff summaries.

### 3.2 Pi & MCP Configuration Panel
- **Provider Grid**:
  - Discovers all providers and models from `~/.pi/agent/models.json`.
  - Card per provider showing Base URL, Model ID, Context Window, and Auth status.
  - **"Test Ping"** button: Performs an instant HTTP test request and displays latency in milliseconds.
  - **"Set as Default"** button: Sets the active provider/model in `~/.pi/agent/settings.json`.
- **Add Custom Provider Form**:
  - Allows adding new endpoints (e.g. local vLLM, LMStudio, Ollama, cloud API keys) and saves directly to `~/.pi/agent/models.json`.
- **System Doctor Widget**:
  - One-click health check running `runPiDoctor()` and displaying diagnostic output.

---

## 4. REST & SSE API Contract

| Endpoint | Method | Payload / Params | Response | Description |
|:---|:---:|:---|:---|:---|
| `/` | `GET` | - | `text/html` | Serves dashboard web application |
| `/api/status` | `GET` | - | `JSON` | Returns active tasks count, uptime, and binary status |
| `/api/events` | `GET` | - | `text/event-stream` | Real-time SSE stream for active tasks and log deltas |
| `/api/cancel` | `POST` | `{ "taskId": string }` | `JSON` | Cancels specified task process via `cancelPiTask` |
| `/api/config` | `GET` | - | `JSON` | Returns all providers, models, and default selection |
| `/api/config` | `POST` | `{ "providers": ..., "defaultModel": ... }` | `JSON` | Persists changes to `~/.pi/agent/` |
| `/api/test-provider` | `POST` | `{ "url": string }` | `JSON` | Tests URL reachability and returns latency in ms |

---

## 5. Process Lifecycle & Port Management

- **Port Strategy**: Defaults to `7081`. Can be set via `PI_WEB_PORT` environment variable or `--port 7081` CLI flag.
- **Port Conflict Recovery**: If port 7081 is bound to an orphan process, `startWebUi` detects the PID via `lsof`, terminates the dead instance, and cleanly binds.
- **Daemon Mode**: `startWebUi` spawns a detached Node process executing `build/web.js` so the server persists independently of any single MCP request.

---

## 6. Testing Strategy

1. **`tests/pi-config.test.ts`**:
   - Tests reading and parsing `models.json` and `settings.json`.
   - Tests updating default models and adding providers.
   - Tests fallback behavior with mock configs in temporary directories.
2. **`tests/web-server.test.ts`**:
   - Boots HTTP server on dynamic port (`0` or random unassigned port).
   - Tests `GET /` HTML response.
   - Tests `GET /api/status` and `GET /api/config`.
   - Tests `POST /api/cancel` and `POST /api/test-provider`.
   - Tests SSE connection on `GET /api/events`.
3. **`tests/web-daemon.test.ts`**:
   - Tests `getWebStatus`, `startWebUi`, and `stopWebUi`.

---

## 7. CLI & MCP Integration

- Add npm script: `"web": "node build/web.js"` in `package.json`.
- Add CLI command: `pi-agent-mcp web [--port 7081]`.
- Expose MCP tools: `pi_web_start`, `pi_web_status`, `pi_web_stop`.
