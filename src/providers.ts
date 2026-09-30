import type { ProviderConfig } from "./types.js";

export function getProviders(): ProviderConfig[] {
  return [
    {
      id: "freetoken",
      name: "FreeToken Qwen Cluster ($0 cost)",
      baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
      defaultModel: process.env.FREETOKEN_MODEL || "Qwen3.6-35B-A3B-NVFP4",
      apiKey: process.env.FREETOKEN_API_KEY || "free-token",
    },
    {
      id: "nvidia-nim",
      name: "NVIDIA NIM (1M Context)",
      baseUrl: process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1",
      defaultModel: process.env.NVIDIA_NIM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
      apiKey: process.env.NVIDIA_NIM_API_KEY,
    },
    {
      id: "ollama",
      name: "Local Ollama",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      defaultModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b",
      apiKey: "ollama",
    },
    {
      id: "openrouter",
      name: "OpenRouter Cloud",
      baseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "qwen/qwen3-coder",
      apiKey: process.env.OPENROUTER_API_KEY,
    },
  ];
}

export function resolveProvider(name?: string): ProviderConfig {
  const providers = getProviders();
  if (!name) {
    const defaultId = process.env.PI_DEFAULT_PROVIDER || "freetoken";
    return providers.find((p) => p.id === defaultId) || providers[0];
  }
  const match = providers.find((p) => p.id.toLowerCase() === name.toLowerCase());
  if (!match) {
    // If not matching known preset, treat as custom provider or default to freetoken
    return {
      id: name,
      name,
      baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
      defaultModel: "Qwen3.6-35B-A3B-NVFP4",
    };
  }
  return match;
}

export function listProviders(): ProviderConfig[] {
  return getProviders();
}
