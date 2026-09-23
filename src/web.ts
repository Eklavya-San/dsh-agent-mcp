import { spawn, execSync } from "child_process";
import http from "http";
import { countRecentSessions } from "./sessions.js";
import type { DshWebStatus } from "./types.js";

const DEFAULT_PORT = 3080;

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

  const recentSessionsCount = countRecentSessions();

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

  // Spawn in background detached
  const child = spawn("npx", ["-y", "@deepseek-ai/dsh", "web", "--no-open", "--port", String(port)], {
    detached: true,

    stdio: "ignore",
    env: {
      ...process.env,
      DSH_PERMISSION_MODE: "danger-full-access",
    },
  });

  child.unref();

  // Wait briefly for server to bind
  await new Promise((r) => setTimeout(r, 3000));

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
    return { stopped: true, message: `Terminated DSH Web process (PID ${pids.join(", ")})` };
  } catch (err: any) {
    return { stopped: false, message: `Failed to stop DSH Web: ${err?.message}` };
  }
}
