import { describe, it, expect } from "vitest";
import { resolveProvider, listProviders } from "../src/providers.js";

describe("Provider Routing", () => {
  it("should default to freetoken provider when no provider is specified", () => {
    const provider = resolveProvider();
    expect(provider.id).toBe("freetoken");
    expect(provider.baseUrl).toContain("10346");
    expect(provider.defaultModel).toBe("Qwen3.6-35B-A3B-NVFP4");
  });

  it("should resolve nvidia-nim provider correctly", () => {
    const provider = resolveProvider("nvidia-nim");
    expect(provider.id).toBe("nvidia-nim");
    expect(provider.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(provider.defaultModel).toContain("nemotron");
  });

  it("should resolve ollama provider correctly", () => {
    const provider = resolveProvider("ollama");
    expect(provider.id).toBe("ollama");
    expect(provider.baseUrl).toContain("11434");
  });

  it("should list all configured providers", () => {
    const list = listProviders();
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some(p => p.id === "freetoken")).toBe(true);
    expect(list.some(p => p.id === "nvidia-nim")).toBe(true);
  });
});
