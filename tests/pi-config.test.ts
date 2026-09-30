import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getDefaultPiAgentDir,
  loadPiConfigFromDir,
  loadPiConfig,
  setPiDefaultModelInDir,
  setPiDefaultModel,
  savePiProviderToDir,
  savePiProvider,
} from "../src/pi-config.js";

describe("Pi Dynamic Configuration Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pi-config-test-"));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getDefaultPiAgentDir", () => {
    it("should return the default directory or respect PI_AGENT_DIR", () => {
      const dir = getDefaultPiAgentDir();
      expect(dir).toBeTruthy();
      expect(dir).toContain(".pi");
    });
  });

  describe("loadPiConfigFromDir", () => {
    it("should return fallback providers when directory is empty or non-existent", () => {
      const nonExistentDir = join(tempDir, "non-existent");
      const config = loadPiConfigFromDir(nonExistentDir);

      expect(config.providers.length).toBeGreaterThanOrEqual(2);
      expect(config.defaultProvider).toBe("freetoken");
      expect(config.defaultModel).toBe("Qwen3.6-35B-A3B-NVFP4");

      const freetoken = config.providers.find((p) => p.id === "freetoken");
      expect(freetoken).toBeDefined();
      expect(freetoken?.models.length).toBeGreaterThan(0);

      const ollama = config.providers.find((p) => p.id === "ollama");
      expect(ollama).toBeDefined();
    });

    it("should correctly load providers, models, and auth from directory files", () => {
      // Mock models.json
      const mockModels = {
        providers: {
          "custom-llm": {
            name: "Custom LLM Provider",
            baseUrl: "https://api.custom.com/v1",
            api: "openai-completions",
            models: [
              {
                id: "custom-model-1",
                name: "Custom Model 1",
                contextWindow: 128000,
                maxTokens: 8192,
              },
              {
                id: "custom-model-2",
                name: "Custom Model 2",
              },
            ],
          },
        },
      };

      // Mock auth.json
      const mockAuth = {
        "custom-llm": {
          type: "api_key",
          key: "sk-test-secret-key",
        },
      };

      // Mock settings.json
      const mockSettings = {
        defaultProvider: "custom-llm",
        defaultModel: "custom-model-2",
        theme: "light",
        enabledModels: ["custom-llm/custom-model-1", "custom-llm/custom-model-2"],
      };

      writeFileSync(join(tempDir, "models.json"), JSON.stringify(mockModels), "utf8");
      writeFileSync(join(tempDir, "auth.json"), JSON.stringify(mockAuth), "utf8");
      writeFileSync(join(tempDir, "settings.json"), JSON.stringify(mockSettings), "utf8");

      const config = loadPiConfigFromDir(tempDir);

      expect(config.defaultProvider).toBe("custom-llm");
      expect(config.defaultModel).toBe("custom-model-2");
      expect(config.theme).toBe("light");
      expect(config.enabledModels).toEqual(["custom-llm/custom-model-1", "custom-llm/custom-model-2"]);

      const customProv = config.providers.find((p) => p.id === "custom-llm");
      expect(customProv).toBeDefined();
      expect(customProv?.name).toBe("Custom LLM Provider");
      expect(customProv?.baseUrl).toBe("https://api.custom.com/v1");
      expect(customProv?.apiKey).toBe("sk-test-secret-key");
      expect(customProv?.models.length).toBe(2);
      expect(customProv?.models[0].id).toBe("custom-model-1");
    });
  });

  describe("setPiDefaultModelInDir & setPiDefaultModel", () => {
    it("should update defaultProvider and defaultModel in settings.json", () => {
      setPiDefaultModelInDir(tempDir, "nvidia-nim", "nvidia/nemotron-3.5-lightning-30b-a3b");

      const settingsPath = join(tempDir, "settings.json");
      expect(existsSync(settingsPath)).toBe(true);

      const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(saved.defaultProvider).toBe("nvidia-nim");
      expect(saved.defaultModel).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");

      // Verify loadPiConfigFromDir picks it up
      const config = loadPiConfigFromDir(tempDir);
      expect(config.defaultProvider).toBe("nvidia-nim");
      expect(config.defaultModel).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    });
  });

  describe("savePiProviderToDir & savePiProvider", () => {
    it("should upsert a new provider into models.json", () => {
      const newProviderConfig = {
        name: "My Local vLLM",
        baseUrl: "http://localhost:8000/v1",
        api: "openai-completions",
        models: [
          {
            id: "meta-llama/Llama-3-70B",
            name: "Llama 3 70B",
          },
        ],
      };

      savePiProviderToDir(tempDir, "vllm-local", newProviderConfig);

      const modelsPath = join(tempDir, "models.json");
      expect(existsSync(modelsPath)).toBe(true);

      const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
      expect(saved.providers["vllm-local"]).toBeDefined();
      expect(saved.providers["vllm-local"].name).toBe("My Local vLLM");
      expect(saved.providers["vllm-local"].baseUrl).toBe("http://localhost:8000/v1");

      const config = loadPiConfigFromDir(tempDir);
      const loadedProv = config.providers.find((p) => p.id === "vllm-local");
      expect(loadedProv).toBeDefined();
      expect(loadedProv?.models[0].id).toBe("meta-llama/Llama-3-70B");
    });
  });
});
