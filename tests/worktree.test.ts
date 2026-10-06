import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskWorktree, getTaskWorktreeRoot, removeTaskWorktree } from "../src/worktree.js";

const tempDirs: string[] = [];

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-worktree-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("task git worktrees", () => {
  it("creates an isolated worktree and keeps primary changes untouched", () => {
    const repo = createRepo();
    const worktree = createTaskWorktree(repo, "task-123");

    expect(worktree.path).toBe(resolve(getTaskWorktreeRoot(repo), "task-123"));
    expect(existsSync(worktree.path)).toBe(true);
    expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree.path, encoding: "utf8" }).trim()).toBe(worktree.baseCommit);

    writeFileSync(join(worktree.path, "agent.txt"), "worker change\n");
    expect(existsSync(join(repo, "agent.txt"))).toBe(false);
    expect(readFileSync(join(worktree.path, "agent.txt"), "utf8")).toContain("worker change");

    removeTaskWorktree(worktree, true);
    expect(existsSync(worktree.path)).toBe(false);
    expect(execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" })).not.toContain(worktree.path);
  });

  it("rejects traversal task ids", () => {
    const repo = createRepo();
    expect(() => createTaskWorktree(repo, "../escape")).toThrow(/Invalid task id/);
  });

  it("preserves a failed worktree until explicitly removed", () => {
    const repo = createRepo();
    const worktree = createTaskWorktree(repo, "failed-task");
    writeFileSync(join(worktree.path, "failure.txt"), "debug me\n");

    expect(existsSync(join(worktree.path, "failure.txt"))).toBe(true);
    removeTaskWorktree(worktree, true);
    expect(existsSync(worktree.path)).toBe(false);
  });
});
