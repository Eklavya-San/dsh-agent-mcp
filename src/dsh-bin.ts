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
 * Never executes npx over network to check installation.
 */
export function checkDshInstalled(): { installed: boolean; version: string; path?: string } {
  // 1. Explicit environment variable
  if (process.env.DSH_BIN && process.env.DSH_BIN.trim().length > 0) {
    const customBin = process.env.DSH_BIN.trim();
    try {
      const versionOutput = execSync(`"${customBin}" --version`, {
        encoding: "utf-8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return {
        installed: true,
        version: versionOutput || "detected",
        path: customBin,
      };
    } catch {
      return {
        installed: false,
        version: "unknown",
        path: customBin,
      };
    }
  }

  // 2. Check if 'dsh' is available in PATH
  try {
    const whichOutput = execSync("which dsh", {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (whichOutput) {
      try {
        const versionOutput = execSync(`"${whichOutput}" --version`, {
          encoding: "utf-8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return {
          installed: true,
          version: versionOutput || "detected",
          path: whichOutput,
        };
      } catch {
        return {
          installed: true,
          version: "detected",
          path: whichOutput,
        };
      }
    }
  } catch {}

  // 3. Not installed in system PATH
  return {
    installed: false,
    version: "not installed",
    path: undefined,
  };
}
