import { execSync } from "child_process";

export interface GitSnapshot {
  commit: string;
  status: string;
  files: string[];
}

export function snapshotGit(cwd: string): GitSnapshot {
  try {
    const commit = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const files = status
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.slice(3).trim());

    return { commit, status, files };
  } catch {
    return { commit: "unknown", status: "", files: [] };
  }
}

export function diffWorkerChanges(
  cwd: string,
  before: GitSnapshot
): { filesChanged: string[]; diffSummary: string; rawDiff: string } {
  try {
    const statusAfter = execSync("git status --porcelain", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    const currentFiles = statusAfter
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.slice(3).trim());

    const filesChanged = Array.from(new Set([...currentFiles, ...before.files]));
    const diffStat = execSync("git diff --stat HEAD", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const rawDiff = execSync("git diff HEAD", { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });

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
