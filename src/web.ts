import { spawn, execSync } from "child_process";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";
import type { DshWebStatus } from "./types.js";
import { listActiveTasks, cancelPiTask } from "./runner.js";
import { checkPiInstalled } from "./pi-bin.js";
import { loadPiConfig, setPiDefaultModel, savePiProvider } from "./pi-config.js";

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
        res.end(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pi Agent Dashboard</title></head><body><h1>Pi Agent Web UI</h1><p>Running on port ${getPort()}</p></body></html>`
        );
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

export async function getWebStatus(port = DEFAULT_PORT): Promise<DshWebStatus> {
  const url = `http://127.0.0.1:${port}`;
  let running = false;
  let pid: number | undefined;

  // Check if port responds or process exists
  try {
    const lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim();
    if (lsof) {
      pid = parseInt(lsof.split("\n")[0], 10);
      running = true;
    }
  } catch {
    running = false;
  }

  // Also verify HTTP response if running
  if (running) {
    try {
      running = await new Promise<boolean>((resolve) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch {
      running = false;
    }
  }

  const recentSessionsCount = 0;

  return {
    running,
    port,
    url,
    pid,
    recentSessionsCount,
  };
}

export async function startWebUi(port = DEFAULT_PORT): Promise<DshWebStatus> {
  const current = await getWebStatus(port);
  if (current.running) {
    return current;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [currentFile], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PI_WEB_PORT: String(port),
    },
  });

  child.unref();

  // Wait briefly for server to bind
  await new Promise((r) => setTimeout(r, 1000));

  return await getWebStatus(port);
}

export async function stopWebUi(port = DEFAULT_PORT): Promise<{ stopped: boolean; message: string }> {
  try {
    const lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim();
    if (!lsof) {
      return { stopped: true, message: `No process was listening on port ${port}` };
    }
    const pids = lsof.split("\n").map((p) => p.trim()).filter(Boolean);
    for (const pid of pids) {
      process.kill(parseInt(pid, 10), "SIGTERM");
    }
    return { stopped: true, message: `Terminated Pi Web process (PID ${pids.join(", ")})` };
  } catch (err: any) {
    return { stopped: false, message: `Failed to stop Pi Web: ${err?.message}` };
  }
}

const isMain =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("web.js") ||
    process.argv[1].endsWith("web.ts"));

if (isMain) {
  const port = parseInt(process.env.PI_WEB_PORT || "7081", 10);
  const server = createWebServer();
  server.listen(port, "0.0.0.0", () => {
    process.stderr.write(`Pi Agent Web Dashboard running on http://127.0.0.1:${port}\n`);
  });
}
