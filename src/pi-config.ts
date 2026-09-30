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
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface PiProviderDetail {
  id: string;
  name: string;
  baseUrl: string;
  api?: string;
  apiKey?: string;
  models: PiModelInfo[];
  defaultModel?: string;
  compat?: Record<string, any>;
  [key: string]: any;
}

export interface PiAgentConfig {
  providers: PiProviderDetail[];
  defaultProvider?: string;
  defaultModel?: string;
  enabledModels?: string[];
  theme?: string;
  [key: string]: any;
}

export function getDefaultPiAgentDir(): string {
  return process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function extractApiKey(entry: any): string | undefined {
  if (!entry) return undefined;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object") {
    return entry.key || entry.apiKey || entry.token || undefined;
  }
  return undefined;
}

export function getFallbackProviders(): PiProviderDetail[] {
  return [
    {
      id: "freetoken",
      name: "FreeToken Qwen Cluster ($0 cost)",
      baseUrl: process.env.FREETOKEN_BASE_URL || "http://machinewiseapp.in:10346/v1",
      api: "openai-completions",
      apiKey: process.env.FREETOKEN_API_KEY || "free-token",
      defaultModel: process.env.FREETOKEN_MODEL || "Qwen3.6-35B-A3B-NVFP4",
      models: [
        {
          id: process.env.FREETOKEN_MODEL || "Qwen3.6-35B-A3B-NVFP4",
          name: "Qwen 3.6 35B FP4 (FreeToken)",
          reasoning: true,
          contextWindow: 262144,
          maxTokens: 32768,
        },
      ],
    },
    {
      id: "ollama",
      name: "Local Ollama",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      api: "openai-completions",
      apiKey: "ollama",
      defaultModel: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b",
      models: [
        {
          id: process.env.OLLAMA_MODEL || "qwen2.5-coder:32b",
          name: "Qwen 2.5 Coder 32B (Ollama)",
        },
      ],
    },
  ];
}

export function loadPiConfigFromDir(dirPath: string): PiAgentConfig {
  let settingsData: Record<string, any> = {};
  let authData: Record<string, any> = {};
  let modelsData: Record<string, any> = {};

  const settingsPath = join(dirPath, "settings.json");
  const authPath = join(dirPath, "auth.json");
  const modelsPath = join(dirPath, "models.json");

  if (existsSync(settingsPath)) {
    try {
      settingsData = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      settingsData = {};
    }
  }

  if (existsSync(authPath)) {
    try {
      authData = JSON.parse(readFileSync(authPath, "utf8"));
    } catch {
      authData = {};
    }
  }

  if (existsSync(modelsPath)) {
    try {
      modelsData = JSON.parse(readFileSync(modelsPath, "utf8"));
    } catch {
      modelsData = {};
    }
  }

  const rawProviders = modelsData?.providers || (typeof modelsData === "object" && !Array.isArray(modelsData) ? modelsData : {});
  const providerEntries = Object.entries(rawProviders).filter(
    ([key, val]) => val && typeof val === "object" && key !== "providers"
  );

  if (providerEntries.length === 0) {
    return {
      providers: getFallbackProviders(),
      defaultProvider: settingsData?.defaultProvider || "freetoken",
      defaultModel: settingsData?.defaultModel || "Qwen3.6-35B-A3B-NVFP4",
      enabledModels: Array.isArray(settingsData?.enabledModels) ? settingsData.enabledModels : [],
      theme: settingsData?.theme || "dark",
      ...settingsData,
    };
  }

  const providers: PiProviderDetail[] = providerEntries.map(([id, val]: [string, any]) => {
    const { apiKey: provApiKey, ...restProv } = val;
    let apiKey = extractApiKey(authData[id]) || provApiKey;
    if (!apiKey && id === "nvidia-nim") {
      apiKey = extractApiKey(authData["nvidia"]);
    }
    if (!apiKey) {
      if (id === "freetoken") apiKey = process.env.FREETOKEN_API_KEY || "free-token";
      else if (id === "nvidia-nim") apiKey = process.env.NVIDIA_NIM_API_KEY;
      else if (id === "openrouter") apiKey = process.env.OPENROUTER_API_KEY;
      else if (id === "ollama") apiKey = "ollama";
    }

    const models: PiModelInfo[] = Array.isArray(restProv.models) ? restProv.models : [];
    let defaultModel = restProv.defaultModel;
    if (!defaultModel) {
      if (settingsData?.defaultProvider === id && settingsData?.defaultModel) {
        defaultModel = settingsData.defaultModel;
      } else if (models.length > 0) {
        defaultModel = models[0].id;
      } else {
        defaultModel = "";
      }
    }

    return {
      ...restProv,
      id,
      name: restProv.name || id,
      baseUrl: restProv.baseUrl || "",
      apiKey,
      models,
      defaultModel,
    };
  });

  return {
    providers,
    defaultProvider: settingsData?.defaultProvider || providers[0]?.id || "freetoken",
    defaultModel: settingsData?.defaultModel || providers[0]?.defaultModel || "",
    enabledModels: Array.isArray(settingsData?.enabledModels) ? settingsData.enabledModels : [],
    theme: settingsData?.theme || "dark",
    ...settingsData,
  };
}

export function loadPiConfig(): PiAgentConfig {
  return loadPiConfigFromDir(getDefaultPiAgentDir());
}

export function setPiDefaultModelInDir(dirPath: string, providerId: string, modelId: string): void {
  mkdirSync(dirPath, { recursive: true });
  const settingsPath = join(dirPath, "settings.json");
  let settings: Record<string, any> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }

  settings.defaultProvider = providerId;
  settings.defaultModel = modelId;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

export function setPiDefaultModel(providerId: string, modelId: string): void {
  setPiDefaultModelInDir(getDefaultPiAgentDir(), providerId, modelId);
}

export function savePiProviderToDir(dirPath: string, providerId: string, config: any): void {
  mkdirSync(dirPath, { recursive: true });
  const modelsPath = join(dirPath, "models.json");
  let modelsJson: Record<string, any> = { providers: {} };

  if (existsSync(modelsPath)) {
    try {
      modelsJson = JSON.parse(readFileSync(modelsPath, "utf8"));
    } catch {
      modelsJson = { providers: {} };
    }
  }

  if (!modelsJson.providers || typeof modelsJson.providers !== "object") {
    modelsJson.providers = {};
  }

  modelsJson.providers[providerId] = {
    ...(modelsJson.providers[providerId] || {}),
    ...config,
  };

  writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2) + "\n", "utf8");
}

export function savePiProvider(providerId: string, config: any): void {
  savePiProviderToDir(getDefaultPiAgentDir(), providerId, config);
}
