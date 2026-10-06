import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PiModelInfo {
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; [key: string]: any };
  [key: string]: any;
}
export interface PiProviderDetail { id: string; name: string; baseUrl: string; api?: string; apiKey?: string; models: PiModelInfo[]; defaultModel?: string; compat?: Record<string, any>; [key: string]: any; }
export interface PiAgentConfig { providers: PiProviderDetail[]; defaultProvider?: string; defaultModel?: string; enabledModels?: string[]; theme?: string; [key: string]: any; }

export function getDefaultPiAgentDir(): string { return process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent"); }
function extractApiKey(entry: any): string | undefined { if (!entry) return undefined; if (typeof entry === "string") return entry; if (typeof entry === "object") return entry.key || entry.apiKey || entry.token || undefined; return undefined; }

export function getFallbackProviders(): PiProviderDetail[] {
  return [
    { id: "freetoken", name: "FreeToken", baseUrl: process.env.FREETOKEN_BASE_URL || "", api: "openai-completions", apiKey: process.env.FREETOKEN_API_KEY, defaultModel: process.env.FREETOKEN_MODEL || "", models: process.env.FREETOKEN_MODEL ? [{ id: process.env.FREETOKEN_MODEL, name: process.env.FREETOKEN_MODEL }] : [] },
    { id: "ollama", name: "Local Ollama", baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1", api: "openai-completions", apiKey: "ollama", defaultModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b", models: [{ id: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b", name: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b" }] },
  ];
}

export function loadPiConfigFromDir(dirPath: string): PiAgentConfig {
  let settingsData: Record<string, any> = {}; let authData: Record<string, any> = {}; let modelsData: Record<string, any> = {};
  const settingsPath = join(dirPath, "settings.json"); const authPath = join(dirPath, "auth.json"); const modelsPath = join(dirPath, "models.json");
  if (existsSync(settingsPath)) { try { settingsData = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { settingsData = {}; } }
  if (existsSync(authPath)) { try { authData = JSON.parse(readFileSync(authPath, "utf8")); } catch { authData = {}; } }
  if (existsSync(modelsPath)) { try { modelsData = JSON.parse(readFileSync(modelsPath, "utf8")); } catch { modelsData = {}; } }
  const rawProviders = modelsData?.providers || (typeof modelsData === "object" && !Array.isArray(modelsData) ? modelsData : {});
  const providerEntries = Object.entries(rawProviders).filter(([key, val]) => val && typeof val === "object" && key !== "providers");
  if (providerEntries.length === 0) return { providers: getFallbackProviders(), defaultProvider: settingsData?.defaultProvider || "ollama", defaultModel: settingsData?.defaultModel || process.env.OLLAMA_MODEL || "qwen2.5-coder:32b", enabledModels: Array.isArray(settingsData?.enabledModels) ? settingsData.enabledModels : [], theme: settingsData?.theme || "dark", ...settingsData };
  const providers: PiProviderDetail[] = providerEntries.map(([id, val]: [string, any]) => {
    const { apiKey: provApiKey, ...restProv } = val; let apiKey = extractApiKey(authData[id]) || provApiKey;
    if (!apiKey && id === "nvidia-nim") apiKey = extractApiKey(authData["nvidia"]);
    if (!apiKey) { if (id === "freetoken") apiKey = process.env.FREETOKEN_API_KEY; else if (id === "nvidia-nim") apiKey = process.env.NVIDIA_NIM_API_KEY; else if (id === "openrouter") apiKey = process.env.OPENROUTER_API_KEY; else if (id === "ollama") apiKey = "ollama"; }
    const models: PiModelInfo[] = Array.isArray(restProv.models) ? restProv.models : []; let defaultModel = restProv.defaultModel;
    if (!defaultModel) defaultModel = settingsData?.defaultProvider === id && settingsData?.defaultModel ? settingsData.defaultModel : models[0]?.id || "";
    return { ...restProv, id, name: restProv.name || id, baseUrl: restProv.baseUrl || "", apiKey, models, defaultModel };
  });
  return { providers, defaultProvider: settingsData?.defaultProvider || providers[0]?.id || "", defaultModel: settingsData?.defaultModel || providers[0]?.defaultModel || "", enabledModels: Array.isArray(settingsData?.enabledModels) ? settingsData.enabledModels : [], theme: settingsData?.theme || "dark", ...settingsData };
}
export function loadPiConfig(): PiAgentConfig { return loadPiConfigFromDir(getDefaultPiAgentDir()); }
export function publicPiConfig(config: PiAgentConfig = loadPiConfig()): PiAgentConfig { return { ...config, providers: config.providers.map(({ apiKey, ...provider }) => provider) }; }
export function setPiDefaultModelInDir(dirPath: string, providerId: string, modelId: string): void { mkdirSync(dirPath, { recursive: true }); const settingsPath = join(dirPath, "settings.json"); let settings: Record<string, any> = {}; if (existsSync(settingsPath)) { try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {} } settings.defaultProvider = providerId; settings.defaultModel = modelId; writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8"); }
export function setPiDefaultModel(providerId: string, modelId: string): void { setPiDefaultModelInDir(getDefaultPiAgentDir(), providerId, modelId); }
export function savePiProviderToDir(dirPath: string, providerId: string, config: any): void { mkdirSync(dirPath, { recursive: true }); const modelsPath = join(dirPath, "models.json"); let modelsJson: Record<string, any> = { providers: {} }; if (existsSync(modelsPath)) { try { modelsJson = JSON.parse(readFileSync(modelsPath, "utf8")); } catch { modelsJson = { providers: {} }; } } if (!modelsJson.providers || typeof modelsJson.providers !== "object") modelsJson.providers = {}; modelsJson.providers[providerId] = { ...(modelsJson.providers[providerId] || {}), ...config }; writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2) + "\n", "utf8"); }
export function savePiProvider(providerId: string, config: any): void { savePiProviderToDir(getDefaultPiAgentDir(), providerId, config); }
