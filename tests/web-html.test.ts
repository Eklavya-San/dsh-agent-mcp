import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { getDashboardHtml } from "../src/web-html.js";
import { createWebServer } from "../src/web.js";

describe("Obsidian Dark-Mode Dashboard SPA (web-html.ts)", () => {
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

  describe("getDashboardHtml()", () => {
    it("returns a complete HTML5 document", () => {
      const html = getDashboardHtml();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(1000);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    it("includes obsidian theme colors, tailwind CDN, and responsive meta tags", () => {
      const html = getDashboardHtml();
      expect(html).toContain("tailwindcss.com");
      expect(html).toContain("obsidian");
      expect(html).toContain("#0d0f12");
      expect(html).toContain('name="viewport"');
    });

    it("contains brand header, logo, and title", () => {
      const html = getDashboardHtml();
      expect(html).toContain("pi-agent-mcp");
      expect(html).toContain("Autonomous Worker & Model Monitor");
      expect(html).toContain("Port 7081");
    });

    it("contains navigation tabs for Workers, Models, and Doctor", () => {
      const html = getDashboardHtml();
      expect(html).toContain("Live Workers & Logs");
      expect(html).toContain("Model & MCP Settings");
      expect(html).toContain("Doctor Diagnostics");
    });

    it("contains terminal streaming, SSE EventSource logic, and worker controls", () => {
      const html = getDashboardHtml();
      expect(html).toContain("EventSource");
      expect(html).toContain("/api/events");
      expect(html).toContain("abortWorker");
      expect(html).toContain("/api/cancel");
      expect(html).toContain("Abort Worker");
      expect(html).toContain("live-worker-stream.log");
    });

    it("contains provider config manager and test ping actions", () => {
      const html = getDashboardHtml();
      expect(html).toContain("/api/config");
      expect(html).toContain("/api/test-provider");
      expect(html).toContain("Test Ping");
      expect(html).toContain("Set as Default");
      expect(html).toContain("Add Provider");
    });

    it("contains doctor diagnostics actions and endpoints", () => {
      const html = getDashboardHtml();
      expect(html).toContain("Run Doctor Check");
      expect(html).toContain("/api/doctor");
    });
  });

  describe("HTTP Server Dashboard Routes", () => {
    it("returns 200 with text/html on GET /", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toBe(getDashboardHtml());
    });

    it("returns 200 with text/html on GET /index.html", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/index.html`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toBe(getDashboardHtml());
    });

    it("returns 200 with JSON on GET /api/doctor", async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/api/doctor`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      const data = await res.json();
      expect(data).toHaveProperty("status");
      expect(data).toHaveProperty("piBinary");
      expect(data).toHaveProperty("providers");
      expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(data.status);
    });
  });
});
