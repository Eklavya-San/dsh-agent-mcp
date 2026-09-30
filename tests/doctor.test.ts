import { describe, it, expect } from "vitest";
import { runPiDoctor, runDshDoctor } from "../src/doctor.js";

describe("Pi Doctor Diagnostics", () => {
  it("should return structured health report without hanging", async () => {
    const report = await runPiDoctor();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.status);
    expect(Array.isArray(report.providers)).toBe(true);
    expect(report.providers.length).toBeGreaterThan(0);
    expect(typeof report.piBinary.installed).toBe("boolean");

    for (const provider of report.providers) {
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.name).toBe("string");
      expect(typeof provider.baseUrl).toBe("string");
      expect(typeof provider.model).toBe("string");
      expect(typeof provider.reachable).toBe("boolean");
      if (provider.reachable) {
        expect(typeof provider.latencyMs).toBe("number");
      }
    }

    const reachableCount = report.providers.filter((p) => p.reachable).length;
    if (report.piBinary.installed && reachableCount >= 2) {
      expect(report.status).toBe("HEALTHY");
    } else if (report.piBinary.installed && reachableCount === 1) {
      expect(report.status).toBe("DEGRADED");
    } else {
      expect(report.status).toBe("DOWN");
    }
  }, 10000);

  it("should support runDshDoctor backward compatibility alias", async () => {
    const report = await runDshDoctor();
    expect(["HEALTHY", "DEGRADED", "DOWN"]).toContain(report.status);
    expect(report.piBinary).toBeDefined();
    expect(Array.isArray(report.providers)).toBe(true);
  }, 10000);
});
