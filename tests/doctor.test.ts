import { describe, it, expect } from "vitest";
import { runDshDoctor } from "../src/doctor.js";

describe("DSH Doctor", () => {
  it("should return structured health report", async () => {
    const report = await runDshDoctor();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.status);
    expect(report.dshBinary).toBeDefined();
    expect(typeof report.dshBinary.installed).toBe("boolean");
    expect(report.settings).toBeDefined();
    expect(report.modelEndpoint).toBeDefined();
    expect(report.webUi).toBeDefined();
  });
});
