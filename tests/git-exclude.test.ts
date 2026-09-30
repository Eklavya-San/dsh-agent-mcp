import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ensureLocalGitExclude } from "../src/git.js";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";

describe("Git Info Exclude Cleaner", () => {
  const testRepo = join(process.cwd(), "tests", "scratch-exclude-test");

  beforeEach(() => {
    rmSync(testRepo, { recursive: true, force: true });
    mkdirSync(join(testRepo, ".git", "info"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRepo, { recursive: true, force: true });
  });

  it("should append .pi-live.md by default to .git/info/exclude without duplicating", () => {
    const added1 = ensureLocalGitExclude(testRepo);
    expect(added1).toBe(true);

    const content1 = readFileSync(join(testRepo, ".git", "info", "exclude"), "utf-8");
    expect(content1).toContain(".pi-live.md");

    // Second call should be a no-op
    const added2 = ensureLocalGitExclude(testRepo);
    expect(added2).toBe(false);
  });

  it("should allow appending custom entries without duplicating", () => {
    const added1 = ensureLocalGitExclude(testRepo, ".custom-file.md");
    expect(added1).toBe(true);

    const content1 = readFileSync(join(testRepo, ".git", "info", "exclude"), "utf-8");
    expect(content1).toContain(".custom-file.md");

    const added2 = ensureLocalGitExclude(testRepo, ".custom-file.md");
    expect(added2).toBe(false);
  });
});
