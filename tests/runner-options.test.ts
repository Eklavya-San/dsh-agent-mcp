import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPiRunnerEnv, buildRunnerEnv, runPiTask } from "../src/runner.js";
import { writeFileSync, unlinkSync, chmodSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Pi Runner Environment & Options", () => {
  it("should configure default freetoken provider environment variables", () => {
    const env = buildPiRunnerEnv({
      cwd: process.cwd(),
      task: "sample task",
    });

    expect(env.OPENAI_BASE_URL).toContain("machinewiseapp.in");
    expect(env.FREETOKEN_BASE_URL).toBeDefined();
  });

  it("should configure custom provider environment variables", () => {
    const env = buildPiRunnerEnv({
      cwd: process.cwd(),
      task: "sample task",
      provider: "nvidia-nim",
      apiKey: "custom-nim-key",
    });

    expect(env.OPENAI_BASE_URL).toContain("integrate.api.nvidia.com");
    expect(env.NVIDIA_API_KEY).toBe("custom-nim-key");
    expect(env.OPENAI_API_KEY).toBe("custom-nim-key");
  });

  it("should support endpoint and apiKey overrides via legacy options", () => {
    const env = buildRunnerEnv({
      cwd: process.cwd(),
      task: "test task",
      endpoint: "http://custom-endpoint:9000/v1",
      apiKey: "secret-token",
    });

    expect(env.OPENAI_BASE_URL).toBe("http://custom-endpoint:9000/v1");
    expect(env.OPENAI_API_KEY).toBe("secret-token");
  });
});

describe("Headless runPiTask Execution", () => {
  const testWorkspace = join(tmpdir(), `pi-test-workspace-${Date.now()}`);
  const mockScriptPath = join(tmpdir(), `mock-pi-runner-${Date.now()}.sh`);

  beforeEach(() => {
    mkdirSync(testWorkspace, { recursive: true });
    // Write mock pi binary that outputs text and creates a file
    const script = `#!/bin/sh
echo "Processing task..."
echo "Done with mock task."
exit 0
`;
    writeFileSync(mockScriptPath, script, "utf-8");
    chmodSync(mockScriptPath, 0o755);
    process.env.PI_BIN = mockScriptPath;
  });

  afterEach(() => {
    delete process.env.PI_BIN;
    try {
      unlinkSync(mockScriptPath);
    } catch {}
    try {
      rmSync(testWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("should execute task, stream to .pi-live.md, and return structured result", async () => {
    const result = await runPiTask({
      cwd: testWorkspace,
      task: "Test running headless task",
      timeoutMs: 5000,
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.taskId).toMatch(/^pi-/);
    expect(result.cwd).toBe(testWorkspace);
    expect(result.output).toContain("Processing task...");
    expect(result.output).toContain("Done with mock task.");
    expect(Array.isArray(result.filesChanged)).toBe(true);
    expect(typeof result.diffSummary).toBe("string");
    expect(typeof result.durationMs).toBe("number");

    // Verify .pi-live.md was created in workspace
    const liveFile = join(testWorkspace, ".pi-live.md");
    expect(existsSync(liveFile)).toBe(true);
  });
});
