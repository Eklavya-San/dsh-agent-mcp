import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveProvider, listProviders } from "../src/providers.js";

describe("Provider Routing", () => {
  const originalBase = process.env.FREETOKEN_BASE_URL;
  const originalModel = process.env.FREETOKEN_MODEL;

  beforeEach(() => {
    process.env.FREETOKEN_BASE_URL = "http://127.0.0.1:10346/v1";
    process.env.FREETOKEN_MODEL = "test-model";
  });
  afterEach(() => {
    if (originalBase === undefined) delete process.env.FREETOKEN_BASE_URL; else process.env.FREETOKEN_BASE_URL = originalBase;
    if (originalModel === undefined) delete process.env.FREETOKEN_MODEL; else process.env.FREETOKEN_MODEL = originalModel;
  });

  it("resolves an explicitly configured provider", () => {
    const provider = resolveProvider("freetoken");
    expect(provider.id).toBe("freetoken");
    expect(provider.baseUrl).toContain("10346");
    expect(provider.defaultModel).toBe("test-model");
  });

  it("resolves nvidia-nim provider correctly", () => {
    const provider = resolveProvider("nvidia-nim");
    expect(provider.id).toBe("nvidia-nim");
    expect(provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("resolves ollama provider correctly", () => {
    const provider = resolveProvider("ollama");
    expect(provider.id).toBe("ollama");
    expect(provider.baseUrl).toContain("11434");
  });

  it("lists configured providers without exposing private defaults", () => {
    const list = listProviders();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((p) => p.id === "freetoken")).toBe(true);
    expect(list.find((p) => p.id === "freetoken")?.baseUrl).toBe("http://127.0.0.1:10346/v1");
  });

  it("fails closed for unknown providers", () => {
    expect(() => resolveProvider("does-not-exist")).toThrow(/Unknown provider/);
  });
});
