import { execSync } from "child_process";

export interface GitSnapshot {
  commit: string;
  status: string;
  files: string[];
  gitRoot?: string;
}

export function findGitRoot(cwd: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function snapshotGit(cwd: string): GitSnapshot {
  const root = findGitRoot(cwd) || cwd;
  try {
    const commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const files = status
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.slice(3).trim());

    return { commit, status, files, gitRoot: root };
  } catch {
    return { commit: "unknown", status: "", files: [], gitRoot: undefined };
  }
}

export function diffWorkerChanges(
  cwd: string,
  before: GitSnapshot
): { filesChanged: string[]; diffSummary: string; rawDiff: string } {
  try {
    const root = findGitRoot(cwd) || cwd;
    const statusAfter = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const currentFiles = statusAfter
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.slice(3).trim());

    const filesChanged = Array.from(new Set([...currentFiles, ...before.files]));
    const diffStat = execSync("git diff --stat HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const rawDiff = execSync("git diff HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

    return {
      filesChanged,
      diffSummary: diffStat || (filesChanged.length > 0 ? `${filesChanged.length} file(s) untracked or modified` : "No git changes"),
      rawDiff: rawDiff.slice(0, 8000), // Cap diff to prevent payload bloat
    };
  } catch (err: any) {
    return {
      filesChanged: [],
      diffSummary: "Unable to calculate git diff",
      rawDiff: err?.message || "",
    };
  }
}
