import { execSync } from "child_process";

export interface ResolvedDshCommand {
  cmd: string;
  argsPrefix: string[];
  type: "binary" | "npx";
  display: string;
}

/**
 * Resolves the DeepSeek Harness (DSH) execution binary in order of preference:
 * 1. Explicit DSH_BIN environment variable
 * 2. Installed 'dsh' executable in system PATH
 * 3. Fallback to 'npx -y @deepseek-ai/dsh'
 */
export function resolveDshCommand(): ResolvedDshCommand {
  // 1. Explicit environment variable override
  if (process.env.DSH_BIN && process.env.DSH_BIN.trim().length > 0) {
    const customBin = process.env.DSH_BIN.trim();
    return {
      cmd: customBin,
      argsPrefix: [],
      type: "binary",
      display: customBin,
    };
  }

  // 2. Check if 'dsh' is available in PATH
  try {
    const whichOutput = execSync("which dsh", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (whichOutput) {
      return {
        cmd: whichOutput,
        argsPrefix: [],
        type: "binary",
        display: whichOutput,
      };
    }
  } catch {}

  // 3. Fallback to npx -y @deepseek-ai/dsh
  return {
    cmd: "npx",
    argsPrefix: ["-y", "@deepseek-ai/dsh"],
    type: "npx",
    display: "npx -y @deepseek-ai/dsh",
  };
}

/**
 * Checks if DSH is installed and executable, returning version or fallback status.
 */
export function checkDshInstalled(): { installed: boolean; version: string; path?: string } {
  const resolved = resolveDshCommand();
  try {
    const args = [...resolved.argsPrefix, "--version"];
    const command = [resolved.cmd, ...args].join(" ");
    const versionOutput = execSync(command, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return {
      installed: true,
      version: versionOutput || "detected",
      path: resolved.cmd,
    };
  } catch {
    return {
      installed: false,
      version: "unknown",
      path: resolved.cmd,
    };
  }
}
