import { describe, it, expect, afterAll } from "vitest";
import http from "http";
import { existsSync } from "fs";
import {
  createWebServer,
  getWebStatus,
  startWebUi,
  stopWebUi,
  getWebJsPath,
  parsePortArg,
  DEFAULT_PORT,
} from "../src/web.js";

describe("Web Daemon Management & Lifecycle", () => {
  const TEST_DAEMON_PORT = 7095;

  afterAll(async () => {
    // Ensure test daemon port is cleanly stopped
    await stopWebUi(TEST_DAEMON_PORT);
  });

  describe("getWebJsPath() and CLI Helpers", () => {
    it("should resolve a valid webJsPath that exists on disk", () => {
      const webJsPath = getWebJsPath();
      expect(typeof webJsPath).toBe("string");
      expect(existsSync(webJsPath)).toBe(true);
      expect(webJsPath).toMatch(/web\.(js|ts)$/);
    });

    it("should parse port arguments or fall back to default", () => {
      const origArgv = [...process.argv];

      try {
        process.argv = ["node", "web.js", "--port", "7788"];
        expect(parsePortArg()).toBe(7788);

        process.argv = ["node", "web.js", "-p", "7799"];
        expect(parsePortArg()).toBe(7799);

        process.argv = ["node", "web.js"];
        expect(parsePortArg()).toBe(DEFAULT_PORT);
      } finally {
        process.argv = origArgv;
      }
    });
  });

  describe("getWebStatus()", () => {
    it("should report running: false for an inactive port", async () => {
      const inactivePort = 59876;
      const status = await getWebStatus(inactivePort);

      expect(status.running).toBe(false);
      expect(status.port).toBe(inactivePort);
      expect(status.url).toBe(`http://127.0.0.1:${inactivePort}`);
      expect(status.pid).toBeUndefined();
      expect(status.activeTasksCount).toBeUndefined();
    });

    it("should detect an active in-process Web UI server", async () => {
      const server = createWebServer();
      let listeningPort = 0;

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as any;
          listeningPort = addr.port;
          resolve();
        });
      });

      try {
        const status = await getWebStatus(listeningPort);
        expect(status.running).toBe(true);
        expect(status.port).toBe(listeningPort);
        expect(status.url).toBe(`http://127.0.0.1:${listeningPort}`);
        expect(typeof status.pid).toBe("number");
        expect(status.pid).toBe(process.pid);
        expect(typeof status.activeTasksCount).toBe("number");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("stopWebUi()", () => {
    it("should return stopped: true with message when no process is listening", async () => {
      const inactivePort = 59877;
      const result = await stopWebUi(inactivePort);

      expect(result.stopped).toBe(true);
      expect(result.message).toContain(`No active Web UI process found on port ${inactivePort}`);
    });
  });

  describe("startWebUi() and Daemon Lifecycle", () => {
    it("should return existing status immediately if server is already running", async () => {
      const server = createWebServer();
      let listeningPort = 0;

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as any;
          listeningPort = addr.port;
          resolve();
        });
      });

      try {
        const status = await startWebUi(listeningPort);
        expect(status.running).toBe(true);
        expect(status.port).toBe(listeningPort);
        expect(status.pid).toBe(process.pid);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("should start a detached background daemon, report healthy status, and stop it cleanly", async () => {
      // 1. Ensure port is stopped initially
      await stopWebUi(TEST_DAEMON_PORT);

      // 2. Start daemon
      const startStatus = await startWebUi(TEST_DAEMON_PORT);
      expect(startStatus.running).toBe(true);
      expect(startStatus.port).toBe(TEST_DAEMON_PORT);
      expect(startStatus.url).toBe(`http://127.0.0.1:${TEST_DAEMON_PORT}`);
      expect(typeof startStatus.pid).toBe("number");
      expect(startStatus.pid).toBeGreaterThan(0);

      // 3. Confirm HTTP endpoint responds directly
      const httpRes = await fetch(`http://127.0.0.1:${TEST_DAEMON_PORT}/api/status`);
      expect(httpRes.status).toBe(200);
      const httpData = await httpRes.json();
      expect(httpData.running).toBe(true);
      expect(httpData.port).toBe(TEST_DAEMON_PORT);

      // 4. Inspect status via getWebStatus
      const inspectStatus = await getWebStatus(TEST_DAEMON_PORT);
      expect(inspectStatus.running).toBe(true);
      expect(inspectStatus.pid).toBe(startStatus.pid);
      expect(typeof inspectStatus.activeTasksCount).toBe("number");

      // 5. Stop daemon
      const stopResult = await stopWebUi(TEST_DAEMON_PORT);
      expect(stopResult.stopped).toBe(true);
      expect(stopResult.message).toContain("Terminated");

      // 6. Verify port is now inactive
      const finalStatus = await getWebStatus(TEST_DAEMON_PORT);
      expect(finalStatus.running).toBe(false);
    });
  });
});
