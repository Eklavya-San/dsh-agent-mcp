import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server, TOOLS } from "../src/mcp.js";

describe("MCP Server Tools Registration & Routing", () => {
  it("should define all required pi_* tools and dsh_* aliases in TOOLS array", () => {
    const toolNames = TOOLS.map((t) => t.name);

    expect(toolNames).toContain("pi_run_task");
    expect(toolNames).toContain("pi_doctor");
    expect(toolNames).toContain("pi_list_providers");
    expect(toolNames).toContain("pi_cancel_task");
    expect(toolNames).toContain("pi_list_active_tasks");
    expect(toolNames).toContain("pi_review_task");
    expect(toolNames).toContain("pi_web_start");
    expect(toolNames).toContain("pi_web_status");
    expect(toolNames).toContain("pi_web_stop");

    expect(toolNames).toContain("dsh_run_task");
    expect(toolNames).toContain("dsh_doctor");
    expect(toolNames).toContain("dsh_cancel_task");
    expect(toolNames).toContain("dsh_list_active_tasks");
    expect(toolNames).toContain("dsh_review_task");
    expect(toolNames).toContain("dsh_web_start");
    expect(toolNames).toContain("dsh_web_status");
    expect(toolNames).toContain("dsh_web_stop");
  });

  it("should have correct input schemas for pi_run_task and pi_review_task", () => {
    const runTool = TOOLS.find((t) => t.name === "pi_run_task");
    expect(runTool).toBeDefined();
    expect(runTool?.inputSchema.required).toEqual(["cwd", "task"]);
    expect(runTool?.inputSchema.properties).toHaveProperty("cwd");
    expect(runTool?.inputSchema.properties).toHaveProperty("task");
    expect(runTool?.inputSchema.properties).toHaveProperty("provider");
    expect(runTool?.inputSchema.properties).toHaveProperty("model");

    const reviewTool = TOOLS.find((t) => t.name === "pi_review_task");
    expect(reviewTool).toBeDefined();
    expect(reviewTool?.inputSchema.required).toEqual(["cwd", "brief"]);
    expect(reviewTool?.inputSchema.properties).toHaveProperty("cwd");
    expect(reviewTool?.inputSchema.properties).toHaveProperty("brief");
    expect(reviewTool?.inputSchema.properties).toHaveProperty("testCommand");
  });

  it("should handle MCP client requests over InMemoryTransport", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(clientTransport);

    // Test tools/list
    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name);
    expect(toolNames).toContain("pi_run_task");
    expect(toolNames).toContain("pi_doctor");
    expect(toolNames).toContain("pi_list_providers");
    expect(toolNames).toContain("dsh_run_task");

    // Test calling pi_list_providers
    const providersResult = await client.callTool({
      name: "pi_list_providers",
      arguments: {},
    });
    expect(providersResult.content).toHaveLength(1);
    const parsedProviders = JSON.parse((providersResult.content[0] as any).text);
    expect(parsedProviders.count).toBeGreaterThanOrEqual(1);
    expect(parsedProviders.providers.some((p: any) => p.id === "freetoken")).toBe(true);

    // Test calling pi_list_active_tasks
    const activeTasksResult = await client.callTool({
      name: "pi_list_active_tasks",
      arguments: {},
    });
    const parsedTasks = JSON.parse((activeTasksResult.content[0] as any).text);
    expect(Array.isArray(parsedTasks.tasks)).toBe(true);

    // Test calling pi_cancel_task
    const cancelResult = await client.callTool({
      name: "pi_cancel_task",
      arguments: { taskId: "non-existent-task-id" },
    });
    const parsedCancel = JSON.parse((cancelResult.content[0] as any).text);
    expect(parsedCancel.cancelled).toBe(false);

    // Test legacy alias dsh_cancel_task
    const legacyCancelResult = await client.callTool({
      name: "dsh_cancel_task",
      arguments: { taskId: "non-existent-task-id" },
    });
    const parsedLegacyCancel = JSON.parse((legacyCancelResult.content[0] as any).text);
    expect(parsedLegacyCancel.cancelled).toBe(false);

    // Test calling pi_web_status on unused port
    const webStatusResult = await client.callTool({
      name: "pi_web_status",
      arguments: { port: 59199 },
    });
    const parsedWebStatus = JSON.parse((webStatusResult.content[0] as any).text);
    expect(parsedWebStatus.running).toBe(false);
    expect(parsedWebStatus.port).toBe(59199);

    // Test calling legacy dsh_web_status on unused port
    const legacyWebStatusResult = await client.callTool({
      name: "dsh_web_status",
      arguments: { port: 59199 },
    });
    const parsedLegacyWebStatus = JSON.parse((legacyWebStatusResult.content[0] as any).text);
    expect(parsedLegacyWebStatus.running).toBe(false);
    expect(parsedLegacyWebStatus.port).toBe(59199);

    // Test validation error handling
    const errorResult = await client.callTool({
      name: "pi_run_task",
      arguments: {},
    });
    expect(errorResult.isError).toBe(true);
    const parsedError = JSON.parse((errorResult.content[0] as any).text);
    expect(parsedError.error).toContain("Missing required arguments");

    await client.close();
  });

  it("should communicate with build/mcp.js over stdio JSON-RPC", async () => {
    const child = spawn("node", ["build/mcp.js"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buffer = "";
    const responses: any[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {}
      }
    });

    // Send initialize request
    const initRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-runner", version: "1.0.0" },
      },
    };
    child.stdin.write(JSON.stringify(initRequest) + "\n");

    // Wait for init response
    const waitForResponse = async (id: number, timeout = 3000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = responses.find((r) => r.id === id);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timeout waiting for response to request id ${id}`);
    };

    const initResp = await waitForResponse(1);
    expect(initResp.result.serverInfo.name).toBe("pi-agent-mcp");
    expect(initResp.result.serverInfo.version).toBe("1.0.0");

    // Send initialized notification
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

    // Send tools/list request
    const listToolsRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };
    child.stdin.write(JSON.stringify(listToolsRequest) + "\n");

    const toolsResp = await waitForResponse(2);
    const tools = toolsResp.result.tools;
    const names = tools.map((t: any) => t.name);

    expect(names).toContain("pi_run_task");
    expect(names).toContain("pi_doctor");
    expect(names).toContain("pi_list_providers");
    expect(names).toContain("pi_cancel_task");
    expect(names).toContain("pi_list_active_tasks");
    expect(names).toContain("pi_review_task");
    expect(names).toContain("pi_web_start");
    expect(names).toContain("pi_web_status");
    expect(names).toContain("pi_web_stop");

    child.kill("SIGTERM");
  });
});
