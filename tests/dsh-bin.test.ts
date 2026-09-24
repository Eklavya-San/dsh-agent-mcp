import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveDshCommand, checkDshInstalled } from "../src/dsh-bin.js";

describe("DSH Binary Resolution", () => {
  const originalEnv = process.env.DSH_BIN;

  beforeEach(() => {
    delete process.env.DSH_BIN;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DSH_BIN = originalEnv;
    } else {
      delete process.env.DSH_BIN;
    }
  });

  it("should respect explicit DSH_BIN environment variable", () => {
    process.env.DSH_BIN = "/custom/bin/dsh";
    const resolved = resolveDshCommand();
    expect(resolved.cmd).toBe("/custom/bin/dsh");
    expect(resolved.type).toBe("binary");
    expect(resolved.argsPrefix).toEqual([]);
  });

  it("should fallback gracefully to system PATH or npx", () => {
    const resolved = resolveDshCommand();
    expect(resolved.cmd).toBeDefined();
    expect(typeof resolved.cmd).toBe("string");
    expect(Array.isArray(resolved.argsPrefix)).toBe(true);
  });

  it("should return checkDshInstalled report without throwing", () => {
    const check = checkDshInstalled();
    expect(typeof check.installed).toBe("boolean");
    expect(typeof check.version).toBe("string");
  });
});
