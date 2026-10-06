import { spawn, execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { PiWebStatus } from "./types.js";
import { listActiveTasks, cancelPiTask } from "./runner.js";
import { listPersistedTasks } from "./task-store.js";
import { checkPiInstalled } from "./pi-bin.js";
import { loadPiConfig, setPiDefaultModel, savePiProvider } from "./pi-config.js";
import { getDashboardHtml } from "./web-html.js";
import { runPiDoctor } from "./doctor.js";

export const taskEvents = new EventEmitter(); taskEvents.setMaxListeners(100);
export interface TaskEvent { type: string; taskId?: string; data?: any; message?: string; [key: string]: any; }
export function emitTaskEvent(event: TaskEvent): void { taskEvents.emit("task-event", event); if (event.type) taskEvents.emit(event.type, event); }
export const DEFAULT_PORT = parseInt(process.env.PI_WEB_PORT || "7081", 10) || 7081;
const HOST = process.env.PI_WEB_HOST || "127.0.0.1"; const TOKEN = process.env.PI_WEB_TOKEN || "";
const IS_LOOPBACK = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";
if (!IS_LOOPBACK && !TOKEN) process.stderr.write("Warning: PI_WEB_HOST is non-loopback but PI_WEB_TOKEN is not configured; remote Web UI requests will be rejected.\n");
const CORS_HEADERS: Record<string, string> = { "Access-Control-Allow-Origin": IS_LOOPBACK ? "*" : "null", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const rateState = new Map<string, { count: number; resetAt: number }>();
function sendJson(res: http.ServerResponse, statusCode: number, data: any): void { res.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS }); res.end(JSON.stringify(data)); }
function authorized(req: http.IncomingMessage): boolean { if (IS_LOOPBACK && !TOKEN) return true; return Boolean(TOKEN && req.headers.authorization === `Bearer ${TOKEN}`); }
function rateLimited(req: http.IncomingMessage): boolean { const key = req.socket.remoteAddress || "unknown"; const now = Date.now(); const current = rateState.get(key); if (!current || current.resetAt <= now) { rateState.set(key, { count: 1, resetAt: now + 60_000 }); return false; } current.count += 1; return current.count > 120; }
function parseJsonBody(req: http.IncomingMessage): Promise<any> { return new Promise((resolve, reject) => { let body = ""; req.on("data", (chunk) => { body += chunk; if (body.length > 1024 * 1024) { req.destroy(); reject(new Error("Request body too large")); } }); req.on("end", () => { if (!body.trim()) return resolve({}); try { resolve(JSON.parse(body)); } catch (err: any) { reject(new Error(`Invalid JSON: ${err?.message}`)); } }); req.on("error", reject); }); }
async function checkProviderHealth(urlStr: string, timeoutMs = 2500): Promise<{ reachable: boolean; latencyMs: number; error?: string }> { const start = Date.now(); try { const parsed = new URL(urlStr); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP(S) provider URLs are supported"); const client = parsed.protocol === "https:" ? https : http; return await new Promise((resolve) => { const req = client.request(parsed, { method: "GET", timeout: Math.min(Math.max(timeoutMs, 250), 10_000) }, (res) => { res.resume(); resolve({ reachable: Boolean(res.statusCode && res.statusCode < 500), latencyMs: Date.now() - start }); }); req.on("error", (err) => resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message })); req.on("timeout", () => { req.destroy(); resolve({ reachable: false, latencyMs: timeoutMs, error: "Timed out" }); }); req.end(); }); } catch (err: any) { return { reachable: false, latencyMs: Date.now() - start, error: err?.message }; } }

export function createWebServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, CORS_HEADERS); res.end(); return; }
      if (rateLimited(req)) { sendJson(res, 429, { error: "Rate limit exceeded" }); return; }
      if (!authorized(req)) { sendJson(res, 401, { error: "Authentication required" }); return; }
      const reqUrl = new URL(req.url || "/", `http://${HOST}`); const pathname = reqUrl.pathname; const getPort = () => res.socket?.localPort || DEFAULT_PORT;
      if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS }); res.end(getDashboardHtml()); return; }
      if (req.method === "GET" && pathname === "/api/doctor") { try { sendJson(res, 200, await runPiDoctor()); } catch (err: any) { sendJson(res, 500, { error: err?.message || "Doctor check failed" }); } return; }
      if (req.method === "GET" && pathname === "/api/status") { sendJson(res, 200, { running: true, host: HOST, port: getPort(), activeTasks: listActiveTasks(), history: listPersistedTasks(20), piBinary: checkPiInstalled(), uptimeSec: Math.floor(process.uptime()) }); return; }
      if (req.method === "GET" && pathname === "/api/tasks") { const limit = Math.min(100, Math.max(1, parseInt(reqUrl.searchParams.get("limit") || "50", 10) || 50)); sendJson(res, 200, { tasks: listPersistedTasks(limit) }); return; }
      if (req.method === "GET" && pathname === "/api/events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...CORS_HEADERS }); res.write(`data: ${JSON.stringify({ type: "init", activeTasks: listActiveTasks(), tasks: listPersistedTasks(20) })}\n\n`); const onTaskEvent = (evt: TaskEvent) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(evt)}\n\n`); }; taskEvents.on("task-event", onTaskEvent); const timer = setInterval(() => { if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n"); }, 15000); timer.unref(); const cleanup = () => { taskEvents.off("task-event", onTaskEvent); clearInterval(timer); }; req.on("close", cleanup); res.on("close", cleanup); return; }
      if (req.method === "GET" && pathname === "/api/config") { sendJson(res, 200, loadPiConfig()); return; }
      if (req.method === "POST" && pathname === "/api/config") { const body = await parseJsonBody(req); if (body.defaultProvider && body.defaultModel) setPiDefaultModel(body.defaultProvider, body.defaultModel); if (body.providerId && body.providerConfig) savePiProvider(body.providerId, body.providerConfig); sendJson(res, 200, { success: true, config: loadPiConfig() }); return; }
      if (req.method === "POST" && pathname === "/api/cancel") { const body = await parseJsonBody(req); if (typeof body?.taskId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(body.taskId)) { sendJson(res, 400, { error: "Invalid taskId" }); return; } sendJson(res, 200, { taskId: body.taskId, cancelled: cancelPiTask(body.taskId) }); return; }
      if (req.method === "POST" && pathname === "/api/test-provider") { const body = await parseJsonBody(req); if (typeof body?.url !== "string") { sendJson(res, 400, { error: "Missing or invalid url" }); return; } const result = await checkProviderHealth(body.url, typeof body.timeoutMs === "number" ? body.timeoutMs : 2500); sendJson(res, 200, { url: body.url, ...result }); return; }
      sendJson(res, 404, { error: "Not found" });
    } catch (err: any) { const message = err?.message || String(err); sendJson(res, /^(Invalid JSON|Request body too large)/.test(message) ? 400 : 500, { error: message }); }
  });
}

export function getWebJsPath(): string { const currentFile = fileURLToPath(import.meta.url); if (currentFile.endsWith("web.js") && fs.existsSync(currentFile)) return currentFile; const candidate = path.resolve(path.dirname(currentFile), "../build/web.js"); return fs.existsSync(candidate) ? candidate : currentFile; }
export async function getWebStatus(port = DEFAULT_PORT): Promise<PiWebStatus> { const url = `http://127.0.0.1:${port}`; let running = false; let pid: number | undefined; let activeTasksCount: number | undefined; try { const lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim(); if (lsof) { const parsedPid = parseInt(lsof.split("\n")[0], 10); if (!isNaN(parsedPid) && parsedPid > 0) { pid = parsedPid; running = true; } } } catch { running = false; } if (running) { try { const statusData = await new Promise<{ healthy: boolean; activeTasksCount?: number }>((resolve) => { const req = http.get(`${url}/api/status`, { timeout: 2000 }, (res) => { let body = ""; res.on("data", (chunk) => (body += chunk)); res.on("end", () => { try { const parsed = JSON.parse(body); resolve({ healthy: res.statusCode !== undefined && res.statusCode < 500, activeTasksCount: Array.isArray(parsed.activeTasks) ? parsed.activeTasks.length : undefined }); } catch { resolve({ healthy: false }); } }); }); req.on("error", () => resolve({ healthy: false })); req.on("timeout", () => { req.destroy(); resolve({ healthy: false }); }); }); running = statusData.healthy; activeTasksCount = statusData.activeTasksCount; } catch { running = false; } } return { running, port, url, ...(pid !== undefined ? { pid } : {}), ...(activeTasksCount !== undefined ? { activeTasksCount } : {}) }; }
export async function startWebUi(port = DEFAULT_PORT): Promise<PiWebStatus> { const current = await getWebStatus(port); if (current.running) return current; const webJsPath = getWebJsPath(); const child = spawn("node", [webJsPath, "--port", String(port)], { detached: true, stdio: "ignore", env: { ...process.env, PI_WEB_PORT: String(port) } }); child.unref(); const startTime = Date.now(); while (Date.now() - startTime < 3000) { const status = await getWebStatus(port); if (status.running) return status; await new Promise((r) => setTimeout(r, 100)); } return getWebStatus(port); }
export async function stopWebUi(port = DEFAULT_PORT): Promise<{ stopped: boolean; message: string }> { try { let lsof = ""; try { lsof = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: "utf-8" }).trim(); } catch { return { stopped: true, message: `No active Web UI process found on port ${port}` }; } if (!lsof) return { stopped: true, message: `No active Web UI process found on port ${port}` }; for (const pidStr of lsof.split("\n").map((p) => p.trim()).filter(Boolean)) { const pid = parseInt(pidStr, 10); if (!isNaN(pid) && pid > 0) { try { process.kill(pid, "SIGTERM"); } catch (err: any) { if (err.code !== "ESRCH") throw err; } } } return { stopped: true, message: `Terminated Pi Web process on port ${port}` }; } catch (err: any) { return { stopped: false, message: `Failed to stop Pi Web: ${err?.message || String(err)}` }; } }
export function parsePortArg(): number { const idx = process.argv.indexOf("--port"); if (idx >= 0 && process.argv[idx + 1]) { const parsed = parseInt(process.argv[idx + 1], 10); if (!isNaN(parsed) && parsed > 0) return parsed; } return parseInt(process.env.PI_WEB_PORT || "7081", 10) || DEFAULT_PORT; }
const isMain = Boolean(process.argv[1] && !process.argv[1].includes("vitest") && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].includes("web.js") || process.argv.includes("--port")));
if (isMain) { const port = parsePortArg(); const server = createWebServer(); server.listen(port, HOST, () => process.stderr.write(`Pi Agent Web Dashboard running on http://${HOST}:${port}\n`)); }
