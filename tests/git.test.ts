import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { snapshotGit, diffWorkerChanges, findGitRoot, findGitRepositories } from "../src/git.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

describe("Git Engine", () => {
  it("should capture git commit hash and status in a valid git repo", () => {
    const snapshot = snapshotGit(process.cwd());
    expect(snapshot.commit).toBeDefined();
    expect(snapshot.commit).not.toBe("unknown");
    expect(Array.isArray(snapshot.files)).toBe(true);
  });

  it("should handle non-git directory gracefully without throwing", () => {
    const snapshot = snapshotGit("/tmp");
    expect(snapshot.commit).toBe("unknown");
    expect(snapshot.status).toBe("");
    expect(snapshot.files).toEqual([]);
  });

  it("should calculate diff correctly without throwing", () => {
    const before = snapshotGit(process.cwd());
    const result = diffWorkerChanges(process.cwd(), before);
    expect(result.diffSummary).toBeDefined();
    expect(Array.isArray(result.filesChanged)).toBe(true);
  });

  it("should find git root correctly", () => {
    const root = findGitRoot(process.cwd());
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
  });
});

describe("Multi-Repo Git Traversal", () => {
  const testDir = join(process.cwd(), "tests", "scratch-multi-repo");

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(join(testDir, "repo-frontend"), { recursive: true });
    mkdirSync(join(testDir, "repo-backend"), { recursive: true });

    // Initialize sub-repos
    execSync("git init", { cwd: join(testDir, "repo-frontend"), stdio: "ignore" });
    execSync("git init", { cwd: join(testDir, "repo-backend"), stdio: "ignore" });

    writeFileSync(join(testDir, "repo-frontend", "fileA.txt"), "hello frontend");
    writeFileSync(join(testDir, "repo-backend", "fileB.txt"), "hello backend");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should discover multiple sub-repositories when cwd is a non-git parent", () => {
    const repos = findGitRepositories(testDir);
    expect(repos.length).toBe(2);
    expect(repos.some(r => r.endsWith("repo-frontend"))).toBe(true);
    expect(repos.some(r => r.endsWith("repo-backend"))).toBe(true);
  });

  it("should snapshot and diff files across multiple child repositories", () => {
    const before = snapshotGit(testDir);
    expect(Array.isArray(before.files)).toBe(true);

    // Modify a file in repo-frontend
    writeFileSync(join(testDir, "repo-frontend", "fileA.txt"), "modified frontend");

    const diff = diffWorkerChanges(testDir, before);
    expect(diff.filesChanged.length).toBeGreaterThan(0);
    expect(diff.diffSummary).not.toBe("Unable to calculate git diff");
  });
});

