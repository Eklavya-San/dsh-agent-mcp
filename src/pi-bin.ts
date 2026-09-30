import { execSync } from "child_process";
import { existsSync } from "fs";

let cachedBin: string | null | undefined;

export function resetPiBinaryCache(): void {
  cachedBin = undefined;
}

/**
 * Resolves the Pi CLI binary in order of preference:
 * 1. Explicit PI_BIN environment variable
 * 2. Installed 'pi' executable in system PATH via `which pi`
 * Results are cached in memory to avoid repeated process spawns.
 */
export function resolvePiBinary(): string | null {
  if (cachedBin !== undefined) return cachedBin;

  if (process.env.PI_BIN && existsSync(process.env.PI_BIN)) {
    cachedBin = process.env.PI_BIN;
    return cachedBin;
  }

  try {
    const resolved = execSync("which pi", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (resolved && existsSync(resolved)) {
      cachedBin = resolved;
      return cachedBin;
    }
  } catch {}

  cachedBin = null;
  return null;
}

/**
 * Checks if Pi is installed and executable, returning version and path.
 */
export function checkPiInstalled(): { installed: boolean; path?: string; version?: string } {
  const bin = resolvePiBinary();
  if (!bin) {
    return { installed: false };
  }

  try {
    const version = execSync(`"${bin}" --version`, {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return {
      installed: true,
      path: bin,
      version: version || "unknown",
    };
  } catch {
    return {
      installed: true,
      path: bin,
      version: "unknown",
    };
  }
}

// Compatibility stubs for legacy runner/mcp during phased migration
export interface ResolvedDshCommand {
  cmd: string;
  argsPrefix: string[];
  type: "binary" | "npx";
  display: string;
}

export function resolveDshCommand(): ResolvedDshCommand {
  const bin = resolvePiBinary() || "pi";
  return {
    cmd: bin,
    argsPrefix: [],
    type: "binary",
    display: bin,
  };
}

export function checkDshInstalled(): { installed: boolean; version: string; path?: string } {
  const piCheck = checkPiInstalled();
  return {
    installed: piCheck.installed,
    version: piCheck.version || "unknown",
    path: piCheck.path,
  };
}
