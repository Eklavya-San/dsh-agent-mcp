import { describe, it, expect } from "vitest";
import { formatReviewPrompt, parseReviewVerdict } from "../src/review.js";

describe("Review Engine", () => {
  it("should generate a structured review prompt incorporating brief and diff", () => {
    const prompt = formatReviewPrompt({
      cwd: "/test/dir",
      brief: "Refactor auth middleware to JWT",
      diff: "diff --git a/auth.ts b/auth.ts\n+ jwt.verify(token)",
      testCommand: "npm test",
    });

    expect(prompt).toContain("Refactor auth middleware to JWT");
    expect(prompt).toContain("jwt.verify(token)");
    expect(prompt).toContain("npm test");
  });

  it("should parse structured JSON verdict cleanly", () => {
    const jsonOutput = JSON.stringify({
      verdict: "APPROVED",
      summary: "Clean implementation matching all requirements.",
      specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
      qualityAudit: { issues: [], strengths: ["Solid error handling"] },
    });

    const parsed = parseReviewVerdict(jsonOutput);
    expect(parsed.verdict).toBe("APPROVED");
    expect(parsed.specCompliance.compliant).toBe(true);
  });

  it("should fall back gracefully if model returns unstructured text with APPROVED", () => {
    const textOutput = "Everything looks great. The implementation is [APPROVED].";
    const parsed = parseReviewVerdict(textOutput);
    expect(parsed.verdict).toBe("APPROVED");
  });
});
