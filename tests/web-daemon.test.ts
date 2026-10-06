import { describe, it, expect, afterAll } from "vitest";
import { existsSync } from "fs";
import { createWebServer, getWebStatus, startWebUi, stopWebUi, getWebJsPath, parsePortArg, DEFAULT_PORT } from "../src/web.js";

describe("Web Daemon Management & Lifecycle", () => {
  const TEST_DAEMON_PORT = 7095;
  afterAll(async () => { await stopWebUi(TEST_DAEMON_PORT); });
  describe("getWebJsPath() and CLI Helpers", () => {
    it("should resolve a valid webJsPath that exists on disk", () => { const webJsPath = getWebJsPath(); expect(typeof webJsPath).toBe("string"); expect(existsSync(webJsPath)).toBe(true); expect(webJsPath).toMatch(/web\.(js|ts)$/); });
    it("should parse the supported --port argument or fall back to default", () => { const origArgv = [...process.argv]; try { process.argv = ["node", "web.js", "--port", "7788"]; expect(parsePortArg()).toBe(7788); process.argv = ["node", "web.js"]; expect(parsePortArg()).toBe(DEFAULT_PORT); } finally { process.argv = origArgv; } });
  });
  describe("getWebStatus()", () => {
    it("should report running: false for an inactive port", async () => { const status = await getWebStatus(59876); expect(status.running).toBe(false); expect(status.port).toBe(59876); expect(status.url).toBe("http://127.0.0.1:59876"); expect(status.pid).toBeUndefined(); expect(status.activeTasksCount).toBeUndefined(); });
    it("should detect an active in-process Web UI server", async () => { const server = createWebServer(); let listeningPort = 0; await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => { listeningPort = (server.address() as any).port; resolve(); })); try { const status = await getWebStatus(listeningPort); expect(status.running).toBe(true); expect(status.port).toBe(listeningPort); expect(status.url).toBe(`http://127.0.0.1:${listeningPort}`); expect(typeof status.pid).toBe("number"); expect(status.pid).toBe(process.pid); expect(typeof status.activeTasksCount).toBe("number"); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); } });
  });
  it("should return stopped: true when no process is listening", async () => { const result = await stopWebUi(59877); expect(result.stopped).toBe(true); expect(result.message).toContain("No active Web UI process found on port 59877"); });
  it("should return existing status immediately if server is already running", async () => { const server = createWebServer(); let listeningPort = 0; await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => { listeningPort = (server.address() as any).port; resolve(); })); try { const status = await startWebUi(listeningPort); expect(status.running).toBe(true); expect(status.port).toBe(listeningPort); expect(status.pid).toBe(process.pid); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); } });
  it("should start and stop a detached daemon", async () => { await stopWebUi(TEST_DAEMON_PORT); const startStatus = await startWebUi(TEST_DAEMON_PORT); expect(startStatus.running).toBe(true); expect(startStatus.port).toBe(TEST_DAEMON_PORT); expect(startStatus.url).toBe(`http://127.0.0.1:${TEST_DAEMON_PORT}`); const httpRes = await fetch(`http://127.0.0.1:${TEST_DAEMON_PORT}/api/status`); expect(httpRes.status).toBe(200); const httpData = await httpRes.json(); expect(httpData.running).toBe(true); const stopResult = await stopWebUi(TEST_DAEMON_PORT); expect(stopResult.stopped).toBe(true); expect(stopResult.message).toContain("Terminated"); expect((await getWebStatus(TEST_DAEMON_PORT)).running).toBe(false); });
});
