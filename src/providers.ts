import type { ProviderConfig } from "./types.js";
import { loadPiConfig } from "./pi-config.js";

export function getStaticProviders(): ProviderConfig[] {
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

export function getProviders(): ProviderConfig[] {
  const staticPresets = getStaticProviders();
  try {
    const config = loadPiConfig();
    if (!config.providers || config.providers.length === 0) {
      return staticPresets;
    }

    const dynamicMap = new Map<string, ProviderConfig>();
    for (const p of config.providers) {
      dynamicMap.set(p.id.toLowerCase(), {
        id: p.id,
        name: p.name || p.id,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel || (p.models && p.models[0]?.id) || "",
        apiKey: p.apiKey,
      });
    }

    const result: ProviderConfig[] = [];
    const seen = new Set<string>();

    for (const [idLower, dyn] of dynamicMap) {
      const stat = staticPresets.find((s) => s.id.toLowerCase() === idLower);
      result.push({
        id: dyn.id,
        name: dyn.name || stat?.name || dyn.id,
        baseUrl: dyn.baseUrl || stat?.baseUrl || "",
        defaultModel: dyn.defaultModel || stat?.defaultModel || "",
        apiKey: dyn.apiKey || stat?.apiKey,
      });
      seen.add(idLower);
    }

    for (const stat of staticPresets) {
      if (!seen.has(stat.id.toLowerCase())) {
        result.push(stat);
      }
    }

    return result;
  } catch {
    return staticPresets;
  }
}

export function resolveProvider(name?: string): ProviderConfig {
  const providers = getProviders();
  if (!name) {
    let defaultId = process.env.PI_DEFAULT_PROVIDER;
    if (!defaultId) {
      try {
        const config = loadPiConfig();
        defaultId = config.defaultProvider;
      } catch {
        // ignore
      }
    }
    defaultId = defaultId || "freetoken";
    return providers.find((p) => p.id.toLowerCase() === defaultId!.toLowerCase()) || providers[0];
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
