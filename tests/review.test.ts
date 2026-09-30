import http from "http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  formatPiReviewPrompt,
  parsePiReviewVerdict,
  runPiReview,
  formatReviewPrompt,
  parseReviewVerdict,
  runDshReview,
} from "../src/review.js";

describe("Review Engine (runPiReview & parsers)", () => {
  let mockServer: http.Server;
  let mockPort: number;
  let mockEndpoint: string;
  let mockHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      if (mockHandler) {
        mockHandler(req, res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        mockPort = addr.port;
        mockEndpoint = `http://127.0.0.1:${mockPort}/v1`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  describe("formatPiReviewPrompt", () => {
    it("should generate a structured review prompt incorporating brief, diff, and testCommand", () => {
      const prompt = formatPiReviewPrompt({
        cwd: "/test/dir",
        brief: "Refactor auth middleware to JWT",
        diff: "diff --git a/auth.ts b/auth.ts\n+ jwt.verify(token)",
        testCommand: "npm test",
      });

      expect(prompt).toContain("Refactor auth middleware to JWT");
      expect(prompt).toContain("jwt.verify(token)");
      expect(prompt).toContain("npm test");
      expect(prompt).toContain("verdict");
      expect(prompt).toContain("specCompliance");
      expect(prompt).toContain("qualityAudit");
    });

    it("should handle omitted diff and testCommand cleanly", () => {
      const prompt = formatPiReviewPrompt({
        cwd: "/test/dir",
        brief: "Just verify something",
      });

      expect(prompt).toContain("Just verify something");
      expect(prompt).toContain("None");
      expect(prompt).not.toContain("## TEST COMMAND:");
    });

    it("should maintain backward-compatibility alias formatReviewPrompt", () => {
      expect(formatReviewPrompt).toBe(formatPiReviewPrompt);
    });
  });

  describe("parsePiReviewVerdict", () => {
    it("should parse strict JSON APPROVED cleanly", () => {
      const jsonOutput = JSON.stringify({
        verdict: "APPROVED",
        summary: "Clean implementation matching all requirements.",
        specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
        qualityAudit: { issues: [], strengths: ["Solid error handling"] },
      });

      const parsed = parsePiReviewVerdict(jsonOutput);
      expect(parsed.verdict).toBe("APPROVED");
      expect(parsed.summary).toBe("Clean implementation matching all requirements.");
      expect(parsed.specCompliance.compliant).toBe(true);
      expect(parsed.qualityAudit.strengths).toContain("Solid error handling");
    });

    it("should parse strict JSON NEEDS_REVISION cleanly", () => {
      const jsonOutput = JSON.stringify({
        verdict: "NEEDS_REVISION",
        summary: "Missing edge case handling.",
        specCompliance: {
          compliant: false,
          missingRequirements: ["Token expiration check"],
          unrequestedChanges: [],
        },
        qualityAudit: {
          issues: [{ severity: "CRITICAL", description: "Null pointer on missing header" }],
          strengths: [],
        },
      });

      const parsed = parsePiReviewVerdict(jsonOutput);
      expect(parsed.verdict).toBe("NEEDS_REVISION");
      expect(parsed.specCompliance.compliant).toBe(false);
      expect(parsed.specCompliance.missingRequirements).toContain("Token expiration check");
      expect(parsed.qualityAudit.issues.length).toBe(1);
      expect(parsed.qualityAudit.issues[0].severity).toBe("CRITICAL");
    });

    it("should parse JSON embedded in markdown code blocks", () => {
      const raw = `Here is the verdict:
\`\`\`json
{
  "verdict": "APPROVED",
  "summary": "Looks good in markdown block",
  "specCompliance": { "compliant": true, "missingRequirements": [], "unrequestedChanges": [] },
  "qualityAudit": { "issues": [], "strengths": [] }
}
\`\`\``;
      const parsed = parsePiReviewVerdict(raw);
      expect(parsed.verdict).toBe("APPROVED");
      expect(parsed.summary).toBe("Looks good in markdown block");
    });

    it("should fall back gracefully to APPROVED if model returns unstructured text with APPROVED", () => {
      const textOutput = "Everything looks great. The implementation is [APPROVED].";
      const parsed = parsePiReviewVerdict(textOutput);
      expect(parsed.verdict).toBe("APPROVED");
      expect(parsed.specCompliance.compliant).toBe(true);
    });

    it("should fall back to NEEDS_REVISION if unstructured text contains NEEDS_REVISION", () => {
      const textOutput = "Although partially done, this change [NEEDS REVISION] due to missing tests.";
      const parsed = parsePiReviewVerdict(textOutput);
      expect(parsed.verdict).toBe("NEEDS_REVISION");
      expect(parsed.specCompliance.compliant).toBe(false);
    });

    it("should fall back to NEEDS_REVISION for error or empty responses", () => {
      const textOutput = "[Auto-Fallback]: Review connection failed";
      const parsed = parsePiReviewVerdict(textOutput);
      expect(parsed.verdict).toBe("NEEDS_REVISION");
      expect(parsed.specCompliance.compliant).toBe(false);
    });

    it("should maintain backward-compatibility alias parseReviewVerdict", () => {
      expect(parseReviewVerdict).toBe(parsePiReviewVerdict);
    });
  });

  describe("runPiReview & test failure enforcement", () => {
    it("should maintain backward-compatibility alias runDshReview", () => {
      expect(runDshReview).toBe(runPiReview);
    });

    it("should clamp verdict to NEEDS_REVISION if testCommand fails, even when model approves", async () => {
      // Mock LLM server returning APPROVED
      mockHandler = (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const responseBody = JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "APPROVED",
                    summary: "Model thought it was perfect!",
                    specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
                    qualityAudit: { issues: [], strengths: ["Looks clean"] },
                  }),
                },
              },
            ],
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(responseBody);
        });
      };

      const result = await runPiReview({
        cwd: process.cwd(),
        brief: "Ensure authentication works",
        diff: "diff --git a/file.ts b/file.ts\n+ const ok = true;",
        testCommand: "node -e 'process.exit(1)'",
        endpoint: mockEndpoint,
      });

      expect(result.testResults).toBeDefined();
      expect(result.testResults?.passed).toBe(false);
      expect(result.verdict).toBe("NEEDS_REVISION");
      expect(result.summary).toContain("[Tests Failed: node -e 'process.exit(1)']");
    });

    it("should preserve APPROVED verdict when model approves and testCommand passes", async () => {
      mockHandler = (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const responseBody = JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    verdict: "APPROVED",
                    summary: "Everything passes nicely.",
                    specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] },
                    qualityAudit: { issues: [], strengths: ["Passed all tests"] },
                  }),
                },
              },
            ],
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(responseBody);
        });
      };

      const result = await runPiReview({
        cwd: process.cwd(),
        brief: "Ensure tests pass",
        diff: "diff --git a/test.ts b/test.ts\n+ expect(true).toBe(true);",
        testCommand: "node -e 'process.exit(0)'",
        endpoint: mockEndpoint,
      });

      expect(result.testResults).toBeDefined();
      expect(result.testResults?.passed).toBe(true);
      expect(result.verdict).toBe("APPROVED");
      expect(result.summary).toBe("Everything passes nicely.");
    });

    it("should handle endpoint connection failure with graceful Auto-Fallback", async () => {
      const result = await runPiReview({
        cwd: process.cwd(),
        brief: "Test endpoint fallback",
        diff: "diff --git a/test.ts b/test.ts\n+ fallback",
        endpoint: "http://127.0.0.1:1", // guaranteed unconnectable port
      });

      expect(result.verdict).toBe("NEEDS_REVISION");
      expect(result.summary).toContain("[Auto-Fallback]");
    });
  });
});
