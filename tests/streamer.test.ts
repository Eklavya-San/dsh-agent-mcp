import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "child_process";
import { resolve } from "path";
import { writeFileSync, unlinkSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Terminal Streamer CLI (pi-live & pi-stream)", () => {
  const rootDir = resolve(__dirname, "..");
  const piLivePath = resolve(rootDir, "bin/pi-live");
  const piStreamPath = resolve(rootDir, "bin/pi-stream.js");

  it("pi-live without arguments should exit with code 1 and print usage", () => {
    const res = spawnSync(piLivePath, [], { encoding: "utf-8" });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain("Usage: pi-live");
  });

  it("pi-live with --help should exit with code 1 and print usage", () => {
    const res = spawnSync(piLivePath, ["--help"], { encoding: "utf-8" });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain("Usage: pi-live");
  });

  it("pi-stream.js should parse JSON event streams and output formatted text", () => {
    const mockScriptPath = join(tmpdir(), `mock-pi-${Date.now()}.sh`);
    const scriptContent = `#!/bin/sh
echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_start"}}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"calculating..."}}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"thinking_end"}}'
echo '{"type":"tool_execution_start","tool":"bash","args":{"command":"ls"}}'
echo '{"type":"tool_execution_end","tool":"bash"}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_start"}}'
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Task finished successfully."}}'
exit 0
`;
    writeFileSync(mockScriptPath, scriptContent, "utf-8");
    chmodSync(mockScriptPath, 0o755);

    try {
      const res = spawnSync(process.execPath, [piStreamPath, "dummy task"], {
        env: {
          ...process.env,
          PI_BIN: mockScriptPath,
        },
        encoding: "utf-8",
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Thinking:");
      expect(res.stdout).toContain("calculating...");
      expect(res.stdout).toContain("⚙️  [bash]");
      expect(res.stdout).toContain("Done");
      expect(res.stdout).toContain("Task finished successfully.");
    } finally {
      try {
        unlinkSync(mockScriptPath);
      } catch {}
    }
  });
});
