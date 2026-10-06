import { describe, it, expect } from "vitest";
import { runVerificationPipeline } from "../src/verify.js";

describe("Verification pipeline", () => {
  it("passes required checks that exit successfully", () => {
    const result = runVerificationPipeline(process.cwd(), { commands: [{ name: "ok", command: "node -e 'process.stdout.write(\"ok\")'", required: true }] });
    expect(result.passed).toBe(true); expect(result.checks[0].passed).toBe(true); expect(result.checks[0].stdout).toContain("ok");
  });
  it("blocks approval when a required check fails", () => {
    const result = runVerificationPipeline(process.cwd(), { commands: [{ name: "fail", command: "node -e 'process.stderr.write(\"bad\"); process.exit(2)'", required: true }] });
    expect(result.passed).toBe(false); expect(result.checks[0].exitCode).toBe(2); expect(result.checks[0].stderr).toContain("bad");
  });
  it("captures timeouts", () => {
    const result = runVerificationPipeline(process.cwd(), { timeoutMs: 1000, commands: [{ name: "timeout", command: "node -e 'setTimeout(() => {}, 5000)'", required: true }] });
    expect(result.passed).toBe(false); expect(result.checks[0].timedOut).toBe(true);
  });
});
