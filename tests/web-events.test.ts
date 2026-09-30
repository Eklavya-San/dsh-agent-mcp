import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "http";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createWebServer, emitTaskEvent, taskEvents } from "../src/web.js";
import { cancelPiTask, registerActiveTask, runPiTask } from "../src/runner.js";

interface SseClient {
  res: http.IncomingMessage;
  req: http.ClientRequest;
  events: any[];
  rawChunks: string[];
  waitForEvent: (predicate: (evt: any) => boolean, timeoutMs?: number) => Promise<any>;
  close: () => Promise<void>;
}

async function waitForListenerCount(count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (taskEvents.listenerCount("task-event") !== count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout waiting for listenerCount to reach ${count}, current is ${taskEvents.listenerCount("task-event")}`
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function connectSse(port: number): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    const rawChunks: string[] = [];
    const listeners: Array<(evt: any) => void> = [];

    const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        const str = chunk.toString("utf-8");
        rawChunks.push(str);
        buffer += str;

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed.startsWith("data:")) {
            const jsonStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(jsonStr);
              events.push(parsed);
              for (const l of [...listeners]) {
                l(parsed);
              }
            } catch {}
          }
        }
      });

      const waitForEvent = (predicate: (evt: any) => boolean, timeoutMs = 3000): Promise<any> => {
        const existing = events.find(predicate);
        if (existing) return Promise.resolve(existing);

        return new Promise((resWait, rejWait) => {
          const timer = setTimeout(() => {
            rejWait(new Error("Timeout waiting for SSE event"));
          }, timeoutMs);

          const listener = (evt: any) => {
            if (predicate(evt)) {
              clearTimeout(timer);
              const idx = listeners.indexOf(listener);
              if (idx >= 0) listeners.splice(idx, 1);
              resWait(evt);
            }
          };
          listeners.push(listener);
        });
      };

      const close = async () => {
        req.destroy();
        res.destroy();
      };

      resolve({ res, req, events, rawChunks, waitForEvent, close });
    });

    req.on("error", (err) => {
      if ((err as any).code === "ECONNRESET") return;
      reject(err);
    });
  });
}

describe("Server-Sent Events (SSE) & Task Event Bus", () => {
  let server: http.Server;
  let testPort: number;
  const openClients: SseClient[] = [];

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

  afterEach(async () => {
    while (openClients.length > 0) {
      const client = openClients.pop();
      if (client) {
        await client.close();
      }
    }
    await waitForListenerCount(0);
  });

  afterAll(async () => {
    (server as any).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const trackClient = (client: SseClient): SseClient => {
    openClients.push(client);
    return client;
  };

  it("should return text/event-stream headers and send init event on GET /api/events", async () => {
    const sse = trackClient(await connectSse(testPort));
    expect(sse.res.statusCode).toBe(200);
    expect(sse.res.headers["content-type"]).toBe("text/event-stream");
    expect(sse.res.headers["cache-control"]).toBe("no-cache");
    expect(sse.res.headers["connection"]).toBe("keep-alive");
    expect(sse.res.headers["access-control-allow-origin"]).toBe("*");

    const initEvent = await sse.waitForEvent((e) => e.type === "init");
    expect(initEvent).toBeDefined();
    expect(initEvent.type).toBe("init");
    expect(Array.isArray(initEvent.activeTasks)).toBe(true);
  });

  it("should deliver events emitted via emitTaskEvent to connected SSE client", async () => {
    const sse = trackClient(await connectSse(testPort));
    await sse.waitForEvent((e) => e.type === "init");

    const testEvent = {
      type: "task_started",
      taskId: "test-task-sse-1",
      cwd: "/tmp/sample-workspace",
      task: "Run test compile",
      model: "qwen2.5-coder:32b",
      startTime: Date.now(),
    };

    emitTaskEvent(testEvent);

    const received = await sse.waitForEvent((e) => e.type === "task_started" && e.taskId === "test-task-sse-1");
    expect(received).toBeDefined();
    expect(received.type).toBe("task_started");
    expect(received.taskId).toBe("test-task-sse-1");
    expect(received.task).toBe("Run test compile");
    expect(received.model).toBe("qwen2.5-coder:32b");

    // Test streaming log delta
    emitTaskEvent({
      type: "log_delta",
      taskId: "test-task-sse-1",
      delta: "Building target 1/3...\n",
    });

    const logEvent = await sse.waitForEvent((e) => e.type === "log_delta" && e.taskId === "test-task-sse-1");
    expect(logEvent).toBeDefined();
    expect(logEvent.delta).toBe("Building target 1/3...\n");

    // Test task finish
    emitTaskEvent({
      type: "task_finished",
      taskId: "test-task-sse-1",
      status: "SUCCESS",
      durationMs: 450,
      filesChanged: ["src/index.ts"],
    });

    const finishEvent = await sse.waitForEvent((e) => e.type === "task_finished" && e.taskId === "test-task-sse-1");
    expect(finishEvent).toBeDefined();
    expect(finishEvent.status).toBe("SUCCESS");
    expect(finishEvent.durationMs).toBe(450);
    expect(finishEvent.filesChanged).toEqual(["src/index.ts"]);
  });

  it("should broadcast to multiple concurrent clients and cleanly unregister on disconnect", async () => {
    expect(taskEvents.listenerCount("task-event")).toBe(0);

    const client1 = trackClient(await connectSse(testPort));
    await client1.waitForEvent((e) => e.type === "init");
    await waitForListenerCount(1);

    const client2 = trackClient(await connectSse(testPort));
    await client2.waitForEvent((e) => e.type === "init");
    await waitForListenerCount(2);

    emitTaskEvent({
      type: "broadcast_test",
      message: "hello all clients",
    });

    const [c1Evt, c2Evt] = await Promise.all([
      client1.waitForEvent((e) => e.type === "broadcast_test"),
      client2.waitForEvent((e) => e.type === "broadcast_test"),
    ]);

    expect(c1Evt.message).toBe("hello all clients");
    expect(c2Evt.message).toBe("hello all clients");

    // Close client1 and verify listener is removed
    await client1.close();
    await waitForListenerCount(1);

    // Close client2
    await client2.close();
    await waitForListenerCount(0);
  });

  it("should emit task_cancelled on cancelPiTask and forward to SSE", async () => {
    const sse = trackClient(await connectSse(testPort));
    await sse.waitForEvent((e) => e.type === "init");

    const mockChild: any = { kill: () => true };
    registerActiveTask("cancel-sse-task-99", {
      child: mockChild,
      cwd: "/tmp",
      task: "test cancel over sse",
      startTime: Date.now(),
    });

    const cancelled = cancelPiTask("cancel-sse-task-99");
    expect(cancelled).toBe(true);

    const cancelEvt = await sse.waitForEvent((e) => e.type === "task_cancelled" && e.taskId === "cancel-sse-task-99");
    expect(cancelEvt).toBeDefined();
    expect(cancelEvt.taskId).toBe("cancel-sse-task-99");
  });

  it("should stream runner lifecycle events during runPiTask execution", async () => {
    const sse = trackClient(await connectSse(testPort));
    const testWorkspace = mkdtempSync(join(tmpdir(), "pi-sse-workspace-"));
    const mockScriptPath = join(tmpdir(), `mock-pi-sse-${Date.now()}.sh`);

    try {
      await sse.waitForEvent((e) => e.type === "init");

      const script = `#!/bin/sh
echo "SSE log stream line 1"
echo "SSE log stream line 2"
exit 0
`;
      writeFileSync(mockScriptPath, script, "utf-8");
      chmodSync(mockScriptPath, 0o755);
      process.env.PI_BIN = mockScriptPath;

      const runPromise = runPiTask({
        cwd: testWorkspace,
        task: "Verify SSE live streaming",
        timeoutMs: 5000,
      });

      const startedEvt = await sse.waitForEvent((e) => e.type === "task_started");
      expect(startedEvt.taskId).toBeDefined();
      expect(startedEvt.task).toBe("Verify SSE live streaming");

      const logEvt = await sse.waitForEvent((e) => e.type === "log_delta" && e.delta.includes("SSE log stream"));
      expect(logEvt.taskId).toBe(startedEvt.taskId);
      expect(logEvt.delta).toContain("SSE log stream");

      const finishedEvt = await sse.waitForEvent((e) => e.type === "task_finished" && e.taskId === startedEvt.taskId);
      expect(finishedEvt.status).toBe("SUCCESS");
      expect(typeof finishedEvt.durationMs).toBe("number");

      const result = await runPromise;
      expect(result.status).toBe("SUCCESS");
      expect(result.output).toContain("SSE log stream line 1");
    } finally {
      delete process.env.PI_BIN;
      try {
        unlinkSync(mockScriptPath);
      } catch {}
      try {
        rmSync(testWorkspace, { recursive: true, force: true });
      } catch {}
    }
  });
});
