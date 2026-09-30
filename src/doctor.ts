import http from "http";
import https from "https";
import { checkPiInstalled } from "./pi-bin.js";
import { getProviders } from "./providers.js";
import type { PiDoctorReport } from "./types.js";

async function checkProviderHealth(
  urlStr: string,
  timeoutMs = 2500
): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === "https:" ? https : http;

    return await new Promise((resolve) => {
      const req = client.request(
        parsed,
        { method: "GET", timeout: timeoutMs },
        (res) => {
          res.resume();
          resolve({ reachable: true, latencyMs: Date.now() - start });
        }
      );

      req.on("error", (err) => {
        resolve({ reachable: false, latencyMs: Date.now() - start, error: err.message });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ reachable: false, latencyMs: timeoutMs, error: "Timed out" });
      });

      req.end();
    });
  } catch (err: any) {
    return { reachable: false, latencyMs: Date.now() - start, error: err?.message };
  }
}

export async function runPiDoctor(): Promise<PiDoctorReport> {
  const piCheck = checkPiInstalled();
  const providers = getProviders();

  const providerResults = await Promise.all(
    providers.map(async (p) => {
      const check = await checkProviderHealth(p.baseUrl);
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        model: p.defaultModel,
        reachable: check.reachable,
        latencyMs: check.latencyMs,
        error: check.error,
      };
    })
  );

  const reachableCount = providerResults.filter((p) => p.reachable).length;
  let status: "HEALTHY" | "DEGRADED" | "DOWN" = "DOWN";

  if (piCheck.installed && reachableCount > 0) {
    status = reachableCount >= 2 ? "HEALTHY" : "DEGRADED";
  }

  return {
    status,
    piBinary: piCheck,
    providers: providerResults,
  };
}

// Backward-compatible alias for existing MCP server until Task 6
export const runDshDoctor = runPiDoctor;

if (process.argv[1]?.endsWith("doctor.js") || process.argv[1]?.endsWith("doctor.ts")) {
  runPiDoctor().then((report) => {
    console.log(JSON.stringify(report, null, 2));
  });
}
