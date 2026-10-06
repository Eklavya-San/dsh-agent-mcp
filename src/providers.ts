import type { ProviderConfig } from "./types.js";
import { loadPiConfig } from "./pi-config.js";

function envProvider(id: string, name: string, baseUrlEnv: string, modelEnv: string, apiKeyEnv?: string): ProviderConfig {
  return { id, name, baseUrl: process.env[baseUrlEnv] || "", defaultModel: process.env[modelEnv] || "", ...(apiKeyEnv && process.env[apiKeyEnv] ? { apiKey: process.env[apiKeyEnv] } : {}) };
}
export function getStaticProviders(): ProviderConfig[] {
  return [
    envProvider("freetoken", "FreeToken", "FREETOKEN_BASE_URL", "FREETOKEN_MODEL", "FREETOKEN_API_KEY"),
    { id: "nvidia-nim", name: "NVIDIA NIM", baseUrl: process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1", defaultModel: process.env.NVIDIA_NIM_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b", apiKey: process.env.NVIDIA_NIM_API_KEY },
    { id: "ollama", name: "Local Ollama", baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1", defaultModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b", apiKey: "ollama" },
    { id: "openrouter", name: "OpenRouter Cloud", baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1", defaultModel: process.env.OPENROUTER_MODEL || "qwen/qwen3-coder", apiKey: process.env.OPENROUTER_API_KEY },
  ];
}
export function getProviders(): ProviderConfig[] {
  const staticPresets = getStaticProviders();
  try {
    const config = loadPiConfig();
    if (!config.providers || config.providers.length === 0) return staticPresets;
    const dynamicMap = new Map<string, ProviderConfig>();
    for (const p of config.providers) dynamicMap.set(p.id.toLowerCase(), { id: p.id, name: p.name || p.id, baseUrl: p.baseUrl || "", defaultModel: p.defaultModel || (p.models && p.models[0]?.id) || "", apiKey: p.apiKey, authHeader: (p as any).authHeader });
    const result: ProviderConfig[] = []; const seen = new Set<string>();
    for (const [idLower, dyn] of dynamicMap) {
      const stat = staticPresets.find((s) => s.id.toLowerCase() === idLower);
      result.push({ id: dyn.id, name: dyn.name || stat?.name || dyn.id, baseUrl: dyn.baseUrl || stat?.baseUrl || "", defaultModel: dyn.defaultModel || stat?.defaultModel || "", apiKey: dyn.apiKey || stat?.apiKey, authHeader: dyn.authHeader || stat?.authHeader });
      seen.add(idLower);
    }
    for (const stat of staticPresets) if (!seen.has(stat.id.toLowerCase())) result.push(stat);
    return result;
  } catch { return staticPresets; }
}
export function resolveProvider(name?: string): ProviderConfig {
  const providers = getProviders(); let selected = name;
  if (!selected) { selected = process.env.PI_DEFAULT_PROVIDER; if (!selected) { try { selected = loadPiConfig().defaultProvider; } catch {} } selected = selected || "ollama"; }
  const match = providers.find((p) => p.id.toLowerCase() === selected!.toLowerCase());
  if (!match) throw new Error(`Unknown provider '${selected}'. Configure it before running a task.`);
  if (!match.baseUrl) throw new Error(`Provider '${match.id}' has no endpoint configured. Set its base URL in configuration or the provider environment variable.`);
  if (!match.defaultModel) throw new Error(`Provider '${match.id}' has no model configured. Set its default model before running a task.`);
  return match;
}
export function listProviders(): Array<Omit<ProviderConfig, "apiKey"> & { authConfigured: boolean }> {
  return getProviders().map(({ apiKey, ...provider }) => ({ ...provider, authConfigured: Boolean(apiKey) }));
}
