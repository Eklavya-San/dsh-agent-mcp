import { execSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";

export interface GitSnapshot {
  commit: string;
  status: string;
  files: string[];
  gitRoot?: string;
  subRepos?: string[];
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

export function findGitRepositories(cwd: string): string[] {
  const root = findGitRoot(cwd);
  if (root && resolve(root) === resolve(cwd)) return [root];

  const repos: string[] = [];
  try {
    const entries = readdirSync(cwd);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const fullPath = join(cwd, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          if (existsSync(join(fullPath, ".git"))) {
            repos.push(fullPath);
          }
        }
      } catch {}
    }
  } catch {}

  if (repos.length > 0) return repos;
  if (root) return [root];

  return repos;
}

export function snapshotGit(cwd: string): GitSnapshot {
  const repos = findGitRepositories(cwd);

  if (repos.length === 0) {
    return { commit: "unknown", status: "", files: [], gitRoot: undefined, subRepos: [] };
  }

  if (repos.length === 1) {
    const root = repos[0];
    let commit = "unknown";
    try {
      commit = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {}

    try {
      const status = execSync("git status --porcelain", { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const files = status
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.slice(3).trim());

      return { commit, status, files, gitRoot: root, subRepos: [root] };
    } catch {
      return { commit, status: "", files: [], gitRoot: root, subRepos: [root] };
    }
  }

  // Multi-repo workspace (e.g. mw-fullstack containing mw-frontend and mw-backend)
  const allFiles: string[] = [];
  const statusLines: string[] = [];
  const commits: string[] = [];

  for (const repo of repos) {
    const relPrefix = relative(cwd, repo);
    try {
      const commit = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      commits.push(`${relPrefix}:${commit.slice(0, 7)}`);
    } catch {
      commits.push(`${relPrefix}:init`);
    }

    try {
      const status = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = status.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      for (const line of lines) {
        statusLines.push(`${line.slice(0, 3)}${relPrefix}/${line.slice(3).trim()}`);
        allFiles.push(`${relPrefix}/${line.slice(3).trim()}`);
      }
    } catch {}
  }

  return {
    commit: commits.join(", ") || "multi-repo",
    status: statusLines.join("\n"),
    files: allFiles,
    gitRoot: cwd,
    subRepos: repos,
  };
}

export function diffWorkerChanges(
  cwd: string,
  before: GitSnapshot
): { filesChanged: string[]; diffSummary: string; rawDiff: string } {
  const repos = before.subRepos && before.subRepos.length > 0 ? before.subRepos : findGitRepositories(cwd);

  if (repos.length === 0) {
    return {
      filesChanged: [],
      diffSummary: "No git repositories found in workspace",
      rawDiff: "",
    };
  }

  const allFilesChanged: string[] = [];
  const summaryParts: string[] = [];
  let combinedRawDiff = "";

  for (const repo of repos) {
    const relPrefix = repos.length > 1 ? relative(cwd, repo) : "";
    let currentFiles: string[] = [];
    try {
      const statusAfter = execSync("git status --porcelain", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      currentFiles = statusAfter
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => (relPrefix ? `${relPrefix}/${line.slice(3).trim()}` : line.slice(3).trim()));

      for (const f of currentFiles) {
        if (!allFilesChanged.includes(f)) allFilesChanged.push(f);
      }
    } catch {}

    try {
      const diffStat = execSync("git diff --stat HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (diffStat) {
        summaryParts.push(relPrefix ? `[${relPrefix}]:\n${diffStat}` : diffStat);
      }
    } catch {}

    try {
      const rawDiff = execSync("git diff HEAD", { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      if (rawDiff) {
        combinedRawDiff += (relPrefix ? `\n# Diff for ${relPrefix}\n` : "") + rawDiff;
      }
    } catch {}
  }

  for (const prev of before.files) {
    if (!allFilesChanged.includes(prev)) allFilesChanged.push(prev);
  }

  return {
    filesChanged: allFilesChanged,
    diffSummary: summaryParts.join("\n\n") || (allFilesChanged.length > 0 ? `${allFilesChanged.length} file(s) untracked or modified` : "No git changes"),
    rawDiff: combinedRawDiff.slice(0, 16000),
  };
}
