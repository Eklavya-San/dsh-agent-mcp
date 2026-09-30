import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import http from "http";
import https from "https";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { PiWebStatus, DshWebStatus } from "./types.js";
import { listActiveTasks, cancelPiTask } from "./runner.js";
import { checkPiInstalled } from "./pi-bin.js";
import { loadPiConfig, setPiDefaultModel, savePiProvider } from "./pi-config.js";
import { getDashboardHtml } from "./web-html.js";
import { runPiDoctor } from "./doctor.js";

export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(100);

export interface TaskEvent {
  type: string;
  taskId?: string;
  data?: any;
  message?: string;
  [key: string]: any;
}

export function emitTaskEvent(event: TaskEvent): void {
  taskEvents.emit("task-event", event);
  if (event.type) {
    taskEvents.emit(event.type, event);
  }
}

export const DEFAULT_PORT = parseInt(process.env.PI_WEB_PORT || "7081", 10) || 7081;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err: any) {
        reject(new Error(`Invalid JSON: ${err?.message}`));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

async function checkProviderHealth(
  urlStr: string,
  timeoutMs = 2500
): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === "https:" ? https : http;

    return await new Promise((resolve) => {
      const pingReq = client.request(
        parsed,
        { method: "GET", timeout: timeoutMs },
        (pingRes) => {
          pingRes.resume();
          resolve({ reachable: true, latencyMs: Date.now() - start });
        }
      );

      pingReq.on("error", (err) => {
        resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message });
      });

      pingReq.on("timeout", () => {
        pingReq.destroy();
        resolve({ reachable: false, latencyMs: timeoutMs, error: "Timed out" });
      });

      pingReq.end();
    });
  } catch (err: any) {
    return { reachable: false, latencyMs: Date.now() - start, error: err?.message };
  }
}

export function createWebServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = reqUrl.pathname;

      const getPort = (): number => {
        const addr = server.address();
        if (typeof addr === "object" && addr && addr.port) {
          return addr.port;
        }
        return req.socket.localPort || DEFAULT_PORT;
      };

      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          ...CORS_HEADERS,
        });
        res.end(getDashboardHtml());
        return;
      }

      if (req.method === "GET" && pathname === "/api/doctor") {
        try {
          const report = await runPiDoctor();
          sendJson(res, 200, report);
        } catch (err: any) {
          sendJson(res, 500, { error: err?.message || "Doctor check failed" });
        }
        return;
      }

      if (req.method === "GET" && pathname === "/api/status") {
        sendJson(res, 200, {
          running: true,
          port: getPort(),
          activeTasks: listActiveTasks(),
          piBinary: checkPiInstalled(),
          uptimeSec: Math.floor(process.uptime()),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });

        // Send initial state event immediately upon connection
        res.write(`data: ${JSON.stringify({ type: "init", activeTasks: listActiveTasks() })}\n\n`);

        const onTaskEvent = (evt: TaskEvent) => {
          if (!res.writableEnded && !res.destroyed) {
            res.write(`data: ${JSON.stringify(evt)}\n\n`);
          }
        };

        taskEvents.on("task-event", onTaskEvent);

        const keepAliveTimer = setInterval(() => {
          if (!res.writableEnded && !res.destroyed) {
            res.write(": ping\n\n");
          }
        }, 15000);
        keepAliveTimer.unref();

        let cleanedUp = false;
        const cleanup = () => {
          if (cleanedUp) return;
          cleanedUp = true;
          taskEvents.off("task-event", onTaskEvent);
          clearInterval(keepAliveTimer);
        };

        req.on("close", cleanup);
        res.on("close", cleanup);
        return;
      }

      if (req.method === "GET" && pathname === "/api/config") {
        sendJson(res, 200, loadPiConfig());
        return;
      }

      if (req.method === "POST" && pathname === "/api/config") {
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch (err: any) {
          sendJson(res, 400, { error: err.message || "Invalid JSON" });
          return;
        }

        const { defaultProvider, defaultModel, providerId, providerConfig } = body;
        if (defaultProvider && defaultModel) {
          setPiDefaultModel(defaultProvider, defaultModel);
        }
        if (providerId && providerConfig) {
          savePiProvider(providerId, providerConfig);
        }

        sendJson(res, 200, {
          success: true,
          config: loadPiConfig(),
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/cancel") {
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch (err: any) {
          sendJson(res, 400, { error: err.message || "Invalid JSON" });
          return;
        }

        const taskId = body?.taskId;
        if (!taskId || typeof taskId !== "string") {
          sendJson(res, 400, { error: "Missing or invalid taskId in request body" });
          return;
        }

        const cancelled = cancelPiTask(taskId);
        sendJson(res, 200, {
          taskId,
          cancelled,
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/test-provider") {
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch (err: any) {
          sendJson(res, 400, { error: err.message || "Invalid JSON" });
          return;
        }

        const url = body?.url;
        const timeoutMs = typeof body?.timeoutMs === "number" ? body.timeoutMs : 2500;
        if (!url || typeof url !== "string") {
          sendJson(res, 400, { error: "Missing or invalid url in request body" });
          return;
        }

        const testResult = await checkProviderHealth(url, timeoutMs);
        sendJson(res, 200, {
          url,
          reachable: testResult.reachable,
          latencyMs: testResult.latencyMs,
          ...(testResult.error ? { error: testResult.error } : {}),
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err: any) {
      sendJson(res, 500, { error: err?.message || "Internal server error" });
    }
  });

  return server;
}

export function getWebJsPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  if (currentFile.endsWith("web.js") && fs.existsSync(currentFile)) {
    return currentFile;
  }
  const candidate = path.resolve(path.dirname(currentFile), "../build/web.js");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return currentFile;
}

export async function getWebStatus(port = DEFAULT_PORT): Promise<PiWebStatus> {
  const url = `http://127.0.0.1:${port}`;
  let running = false;
  let pid: number | undefined;
  let activeTasksCount: number | undefined;

  // Check if port responds or process exists
  try {
    const lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim();
    if (lsof) {
      const parsedPid = parseInt(lsof.split("\n")[0], 10);
      if (!isNaN(parsedPid) && parsedPid > 0) {
        pid = parsedPid;
        running = true;
      }
    }
  } catch {
    running = false;
  }

  // Fast HTTP GET to confirm server health and get active tasks count
  if (running) {
    try {
      const statusData = await new Promise<{ healthy: boolean; activeTasksCount?: number }>((resolve) => {
        const req = http.get(`${url}/api/status`, { timeout: 2000 }, (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            const healthy = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 500;
            let tasksCount: number | undefined;
            if (healthy && body) {
              try {
                const parsed = JSON.parse(body);
                if (Array.isArray(parsed.activeTasks)) {
                  tasksCount = parsed.activeTasks.length;
                }
              } catch {}
            }
            resolve({ healthy, activeTasksCount: tasksCount });
          });
        });
        req.on("error", () => resolve({ healthy: false }));
        req.on("timeout", () => {
          req.destroy();
          resolve({ healthy: false });
        });
      });

      running = statusData.healthy;
      if (running && statusData.activeTasksCount !== undefined) {
        activeTasksCount = statusData.activeTasksCount;
      }
    } catch {
      running = false;
    }
  }

  return {
    running,
    port,
    url,
    ...(pid !== undefined ? { pid } : {}),
    ...(activeTasksCount !== undefined ? { activeTasksCount } : {}),
  };
}

export async function startWebUi(port = DEFAULT_PORT): Promise<PiWebStatus> {
  const current = await getWebStatus(port);
  if (current.running) {
    return current;
  }

  const webJsPath = getWebJsPath();
  const child = spawn("node", [webJsPath, "--port", String(port)], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PI_WEB_PORT: String(port),
    },
  });

  child.unref();

  // Wait up to 3000ms for server to bind
  const startTime = Date.now();
  while (Date.now() - startTime < 3000) {
    const status = await getWebStatus(port);
    if (status.running) {
      return status;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  return await getWebStatus(port);
}

export async function stopWebUi(port = DEFAULT_PORT): Promise<{ stopped: boolean; message: string }> {
  try {
    let lsof = "";
    try {
      lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim();
    } catch {
      // lsof exits with non-zero when no matching process is listening
      return { stopped: true, message: `No active Web UI process found on port ${port}` };
    }

    if (!lsof) {
      return { stopped: true, message: `No active Web UI process found on port ${port}` };
    }
    const pids = lsof.split("\n").map((p) => p.trim()).filter(Boolean);
    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (killErr: any) {
          if (killErr.code !== "ESRCH") {
            throw killErr;
          }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 100));
    return { stopped: true, message: `Terminated Pi Web process (PID ${pids.join(", ")}) on port ${port}` };
  } catch (err: any) {
    return { stopped: false, message: `Failed to stop Pi Web: ${err?.message || String(err)}` };
  }
}

export function parsePortArg(): number {
  const portIndex = process.argv.indexOf("--port");
  if (portIndex !== -1 && process.argv[portIndex + 1]) {
    const parsed = parseInt(process.argv[portIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const pIndex = process.argv.indexOf("-p");
  if (pIndex !== -1 && process.argv[pIndex + 1]) {
    const parsed = parseInt(process.argv[pIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return parseInt(process.env.PI_WEB_PORT || "7081", 10) || DEFAULT_PORT;
}

const isMain = Boolean(
  process.argv[1] &&
    !process.argv[1].includes("vitest") &&
    (process.argv[1] === fileURLToPath(import.meta.url) ||
      process.argv[1].includes("web.js") ||
      process.argv.includes("--port"))
);

if (isMain) {
  const port = parsePortArg();
  const server = createWebServer();
  server.listen(port, "0.0.0.0", () => {
    process.stderr.write(`Pi Agent Web Dashboard running on http://127.0.0.1:${port}\n`);
  });
}

