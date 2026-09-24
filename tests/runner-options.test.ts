import { describe, it, expect } from "vitest";
import { buildRunnerEnv } from "../src/runner.js";

describe("Runner Option Overrides", () => {
  it("should map task options to standard LLM environment variables", () => {
    const env = buildRunnerEnv({
      cwd: process.cwd(),
      task: "test task",
      model: "qwen-custom:32b",
      endpoint: "http://custom-host:8000/v1",
      apiKey: "custom-token",
    });

    expect(env.DSH_MODEL).toBe("qwen-custom:32b");
    expect(env.OPENAI_MODEL_NAME).toBe("qwen-custom:32b");
    expect(env.OPENAI_BASE_URL).toBe("http://custom-host:8000/v1");
    expect(env.DSH_MODEL_ENDPOINT).toBe("http://custom-host:8000/v1");
    expect(env.OPENAI_API_KEY).toBe("custom-token");
  });
});
