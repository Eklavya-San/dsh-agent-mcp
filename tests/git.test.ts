import { describe, it, expect } from "vitest";
import { snapshotGit, diffWorkerChanges, findGitRoot } from "../src/git.js";

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
