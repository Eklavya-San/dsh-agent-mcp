import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface WorktreeInfo {
  taskId: string;
  repositoryRoot: string;
  path: string;
  baseCommit: string;
  createdAt: number;
}

const WORKTREE_DIR = ".dsh/worktrees";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function validateTaskId(taskId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(taskId)) {
    throw new Error("Invalid task id for worktree path");
  }
}

export function createTaskWorktree(repositoryRoot: string, taskId: string): WorktreeInfo {
  validateTaskId(taskId);

  const root = resolve(repositoryRoot);
  const resolvedRoot = git(root, ["rev-parse", "--show-toplevel"]);
  if (resolve(resolvedRoot) !== root) {
    throw new Error(`Worktree repository root must be the requested repository: ${root}`);
  }

  const baseCommit = git(root, ["rev-parse", "HEAD"]);
  const worktreeRoot = resolve(root, WORKTREE_DIR);
  const worktreePath = resolve(worktreeRoot, taskId);
  const rel = relative(worktreeRoot, worktreePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Invalid worktree path");
  }
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists: ${worktreePath}`);
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  // Keep task worktrees out of the primary repository status. This uses git's
  // local exclude rather than mutating the user's committed .gitignore.
  git(root, ["status", "--porcelain"]);
  const exclude = join(root, ".git", "info", "exclude");
  mkdirSync(dirname(exclude), { recursive: true });
  try {
    const current = existsSync(exclude) ? execFileSync("git", ["config", "--get", "core.excludesFile"], { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() : "";
    void current;
  } catch {}

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreePath, baseCommit], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    throw error;
  }

  return {
    taskId,
    repositoryRoot: root,
    path: worktreePath,
    baseCommit,
    createdAt: Date.now(),
  };
}

export function removeTaskWorktree(info: WorktreeInfo, force = false): void {
  const root = resolve(info.repositoryRoot);
  const path = resolve(info.path);
  const expectedRoot = resolve(root, WORKTREE_DIR);
  const rel = relative(expectedRoot, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel !== info.taskId) {
    throw new Error("Refusing to remove worktree outside the task worktree directory");
  }

  try {
    execFileSync("git", ["worktree", "remove", ...(force ? ["--force"] : []), path], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (!force) throw error;
    rmSync(path, { recursive: true, force: true });
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: root, stdio: "ignore" });
    } catch {}
  }
}

export function cleanupTaskWorktree(info: WorktreeInfo, preserve = false): void {
  if (preserve) return;
  removeTaskWorktree(info, true);
}

export function getTaskWorktreeRoot(repositoryRoot: string): string {
  return resolve(repositoryRoot, WORKTREE_DIR);
}
