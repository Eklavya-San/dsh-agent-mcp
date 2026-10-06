import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPiConfigFromDir, publicPiConfig } from "../src/pi-config.js";
import { listProviders } from "../src/providers.js";

describe("security hardening", () => {
  it("does not expose provider credentials through public Pi config", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-config-"));
    try {
      writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { test: { baseUrl: "http://127.0.0.1:9000/v1", apiKey: "super-secret", models: [{ id: "model" }] } } }));
      writeFileSync(join(dir, "auth.json"), JSON.stringify({ test: { token: "another-secret" } }));
      const internal = loadPiConfigFromDir(dir);
      const publicConfig = publicPiConfig(internal);
      expect(internal.providers[0].apiKey).toBe("another-secret");
      expect((publicConfig.providers[0] as any).apiKey).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("never returns API keys from the provider listing", () => {
    const providers = listProviders();
    for (const provider of providers) expect((provider as any).apiKey).toBeUndefined();
  });
});
