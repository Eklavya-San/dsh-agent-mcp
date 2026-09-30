import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolvePiBinary, checkPiInstalled, resetPiBinaryCache, resolveDshCommand, checkDshInstalled } from "../src/pi-bin.js";

describe("Pi Binary Resolution", () => {
  const originalPiBin = process.env.PI_BIN;

  beforeEach(() => {
    resetPiBinaryCache();
  });

  afterEach(() => {
    if (originalPiBin !== undefined) {
      process.env.PI_BIN = originalPiBin;
    } else {
      delete process.env.PI_BIN;
    }
    resetPiBinaryCache();
  });

  it("should resolve pi binary path or return null gracefully", () => {
    const bin = resolvePiBinary();
    expect(bin === null || typeof bin === "string").toBe(true);
  });

  it("should return checkPiInstalled report without throwing", () => {
    const report = checkPiInstalled();
    expect(typeof report.installed).toBe("boolean");
    if (report.installed) {
      expect(typeof report.path).toBe("string");
      expect(typeof report.version).toBe("string");
    }
  });

  it("should prioritize PI_BIN override when path exists", () => {
    process.env.PI_BIN = process.execPath;
    resetPiBinaryCache();
    const bin = resolvePiBinary();
    expect(bin).toBe(process.execPath);
  });

  it("should ignore PI_BIN override when path does not exist", () => {
    process.env.PI_BIN = "/nonexistent/path/to/custom-pi-binary";
    resetPiBinaryCache();
    const bin = resolvePiBinary();
    expect(bin).not.toBe("/nonexistent/path/to/custom-pi-binary");
  });

  it("should cache the resolved binary in memory", () => {
    const first = resolvePiBinary();
    const second = resolvePiBinary();
    expect(first).toBe(second);
  });

  it("should provide backward-compatible resolveDshCommand and checkDshInstalled stubs", () => {
    const dshCmd = resolveDshCommand();
    expect(dshCmd).toBeDefined();
    expect(typeof dshCmd.cmd).toBe("string");
    expect(Array.isArray(dshCmd.argsPrefix)).toBe(true);

    const dshCheck = checkDshInstalled();
    expect(typeof dshCheck.installed).toBe("boolean");
  });
});
