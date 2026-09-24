import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import http from "http";
import https from "https";
import { checkDshInstalled } from "./dsh-bin.js";
import type { DshDoctorReport } from "./types.js";
import { getWebStatus } from "./web.js";

export async function runDshDoctor(): Promise<DshDoctorReport> {
  const dshDir = join(homedir(), ".dsh");
  const settingsPath = join(dshDir, "settings.yaml");

  // 1. Check DSH binary / executable / npx version
  const dshCheck = checkDshInstalled();
  const dshInstalled = dshCheck.installed;
  const dshVersion = dshCheck.version;


  // 2. Read settings.yaml
  let settingsFound = existsSync(settingsPath);
  let defaultModel: { provider: string; model: string } | undefined;
  let detectedBaseUrl: string | undefined;

  if (settingsFound) {
    try {
      const content = readFileSync(settingsPath, "utf-8");
      const defaultSection = content.split("agent-default-model:")[1] || "";
      const providerMatch = defaultSection.match(/provider:\s*([^\s]+)/);
      const modelMatch = defaultSection.match(/model:\s*([^\s]+)/);
      if (providerMatch && modelMatch) {
        defaultModel = {
          provider: providerMatch[1],
          model: modelMatch[1],
        };
      }

      // Try detecting base-url from provider config if present
      const baseUrlMatch = content.match(/base-url:\s*([^\s]+)/);
      if (baseUrlMatch) {
        detectedBaseUrl = baseUrlMatch[1];
      }
    } catch {}
  }

  // 3. Check Model Endpoint connectivity
  const endpointUrl =
    process.env.DSH_MODEL_ENDPOINT ||
    process.env.OPENAI_BASE_URL ||
    detectedBaseUrl ||
    "http://localhost:11434/v1";

  let endpointReachable = false;
  let endpointStatus: number | undefined;
  let endpointError: string | undefined;

  try {
    const isHttps = endpointUrl.startsWith("https://");
    const client = isHttps ? https : http;
    const testUrl = `${endpointUrl.replace(/\/+$/, "")}/models`;

    const reachable = await new Promise<{ ok: boolean; status?: number; error?: string }>((resolve) => {
      const req = client.get(testUrl, { timeout: 5000 }, (res) => {
        resolve({ ok: (res.statusCode !== undefined && res.statusCode < 500), status: res.statusCode });
      });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "Connection timed out" });
      });
    });
    endpointReachable = reachable.ok;
    endpointStatus = reachable.status;
    endpointError = reachable.error;
  } catch (err: any) {
    endpointReachable = false;
    endpointError = err?.message;
  }

  // 4. Check Web UI status
  const webStatus = await getWebStatus();

  let overallStatus: "HEALTHY" | "DEGRADED" | "DOWN" = "HEALTHY";
  if (!dshInstalled || !endpointReachable) {
    overallStatus = "DOWN";
  } else if (!settingsFound) {
    overallStatus = "DEGRADED";
  }

  return {
    status: overallStatus,
    dshBinary: {
      installed: dshInstalled,
      version: dshVersion,
      path: dshCheck.path,
    },
    settings: {
      found: settingsFound,
      path: settingsPath,
      defaultModel,
    },
    modelEndpoint: {
      url: endpointUrl,
      reachable: endpointReachable,
      statusCode: endpointStatus,
      error: endpointError,
    },
    webUi: {
      running: webStatus.running,
      port: webStatus.port,
      url: webStatus.url,
      pid: webStatus.pid,
    },
  };
}

if (process.argv[1]?.endsWith("doctor.js") || process.argv[1]?.endsWith("doctor.ts")) {
  runDshDoctor().then((report) => {
    console.log(JSON.stringify(report, null, 2));
  });
}

