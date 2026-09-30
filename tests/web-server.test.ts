import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createWebServer, DEFAULT_PORT } from "../src/web.js";

describe("Web Server REST API", () => {
  let server: http.Server;
  let testPort: number;
  let tempDir: string;
  let origAgentDir: string | undefined;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-test-"));
    origAgentDir = process.env.PI_AGENT_DIR;
    process.env.PI_AGENT_DIR = tempDir;

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
    if (origAgentDir !== undefined) {
      process.env.PI_AGENT_DIR = origAgentDir;
    } else {
      delete process.env.PI_AGENT_DIR;
    }
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should have DEFAULT_PORT set to 7081", () => {
    expect(DEFAULT_PORT).toBe(7081);
  });

  it("should handle CORS preflight OPTIONS request", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`, {
      method: "OPTIONS",
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("should return status on GET /api/status with CORS header", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const data = await res.json();
    expect(data.running).toBe(true);
    expect(data.port).toBe(testPort);
    expect(Array.isArray(data.activeTasks)).toBe(true);
    expect(typeof data.piBinary).toBe("object");
    expect(typeof data.piBinary.installed).toBe("boolean");
    expect(typeof data.uptimeSec).toBe("number");
  });

  it("should return config on GET /api/config", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.providers)).toBe(true);
    expect(data.defaultProvider).toBeDefined();
    expect(data.defaultModel).toBeDefined();
  });

  it("should update default model and save provider on POST /api/config", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultProvider: "ollama",
        defaultModel: "qwen2.5-coder:32b",
        providerId: "test-vllm",
        providerConfig: {
          name: "Test vLLM Provider",
          baseUrl: "http://localhost:8000/v1",
          defaultModel: "deepseek-coder",
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.config.defaultProvider).toBe("ollama");
    expect(data.config.defaultModel).toBe("qwen2.5-coder:32b");
    expect(data.config.providers.some((p: any) => p.id === "test-vllm")).toBe(true);
  });

  it("should handle task cancellation on POST /api/cancel", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "non-existent-task" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("non-existent-task");
    expect(data.cancelled).toBe(false);
  });

  it("should return 400 on POST /api/cancel with missing taskId", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("should test provider reachability on POST /api/test-provider for reachable endpoint", async () => {
    // Ping ourselves
    const res = await fetch(`http://127.0.0.1:${testPort}/api/test-provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${testPort}/api/status`, timeoutMs: 2000 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reachable).toBe(true);
    expect(data.url).toBe(`http://127.0.0.1:${testPort}/api/status`);
    expect(typeof data.latencyMs).toBe("number");
    expect(data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should test provider reachability on POST /api/test-provider for unreachable endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/test-provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:59999", timeoutMs: 500 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reachable).toBe(false);
    expect(data.url).toBe("http://127.0.0.1:59999");
    expect(typeof data.latencyMs).toBe("number");
    expect(data.error).toBeDefined();
  });

  it("should return 400 on POST /api/test-provider with missing url", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/test-provider`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("should return HTML on GET /", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Pi Agent");
  });

  it("should return 404 for unknown endpoints", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/unknown-endpoint`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("should return 400 for malformed JSON body on POST", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ malformed json",
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid JSON");
  });
});
