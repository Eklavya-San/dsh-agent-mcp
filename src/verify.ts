import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VerificationCheck {
  name: string;
  command: string;
  required: boolean;
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
}

function hasScript(cwd: string, name: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    return typeof pkg?.scripts?.[name] === "string";
  } catch { return false; }
}

export function defaultVerificationCommands(cwd: string): Array<{ name: string; command: string; required: boolean }> {
  const checks: Array<{ name: string; command: string; required: boolean }> = [];
  if (hasScript(cwd, "test")) checks.push({ name: "tests", command: "npm test", required: true });
  if (hasScript(cwd, "typecheck")) checks.push({ name: "typecheck", command: "npm run typecheck", required: true });
  else if (hasScript(cwd, "build")) checks.push({ name: "build", command: "npm run build", required: true });
  if (hasScript(cwd, "lint")) checks.push({ name: "lint", command: "npm run lint", required: true });
  const custom = process.env.PI_VERIFY_COMMAND;
  if (custom) checks.push({ name: "custom", command: custom, required: true });
  return checks;
}

export function runVerificationPipeline(
  cwd: string,
  options: { timeoutMs?: number; commands?: Array<{ name: string; command: string; required?: boolean }> } = {}
): VerificationResult {
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 120000, 15 * 60 * 1000));
  const commands = options.commands || defaultVerificationCommands(cwd);
  const checks: VerificationCheck[] = [];

  for (const definition of commands) {
    const started = Date.now();
    const result = spawnSync("sh", ["-lc", definition.command], {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    });
    const timedOut = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
    checks.push({
      name: definition.name,
      command: definition.command,
      required: definition.required !== false,
      passed: !timedOut && result.status === 0,
      exitCode: typeof result.status === "number" ? result.status : null,
      stdout: String(result.stdout || "").slice(0, 12000),
      stderr: String(result.stderr || result.error?.message || "").slice(0, 12000),
      durationMs: Date.now() - started,
      timedOut,
    });

    if (definition.required !== false && (timedOut || result.status !== 0)) break;
  }

  return { passed: checks.every((check) => !check.required || check.passed), checks };
}
