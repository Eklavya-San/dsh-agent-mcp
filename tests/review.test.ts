import http from "http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { formatPiReviewPrompt, parsePiReviewVerdict, runPiReview, formatReviewPrompt, parseReviewVerdict, runDshReview } from "../src/review.js";

describe("Review Engine (runPiReview & parsers)", () => {
  let mockServer: http.Server; let mockPort: number; let mockEndpoint: string; let mockHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  beforeAll(async () => { mockServer = http.createServer((req, res) => mockHandler ? mockHandler(req, res) : (res.writeHead(404), res.end())); await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => { mockPort = (mockServer.address() as any).port; mockEndpoint = `http://127.0.0.1:${mockPort}/v1`; resolve(); })); });
  afterAll(async () => { await new Promise<void>((resolve) => mockServer.close(() => resolve())); });

  it("formats a structured review prompt", () => { const prompt = formatPiReviewPrompt({ cwd: "/test/dir", brief: "Refactor auth middleware to JWT", diff: "diff --git a/auth.ts b/auth.ts\n+ jwt.verify(token)", testCommand: "npm test" }); expect(prompt).toContain("Refactor auth middleware to JWT"); expect(prompt).toContain("jwt.verify(token)"); expect(prompt).toContain("verdict"); expect(prompt).toContain("specCompliance"); expect(prompt).toContain("qualityAudit"); });
  it("maintains format alias", () => expect(formatReviewPrompt).toBe(formatPiReviewPrompt));

  it("approves only complete structured JSON", () => {
    const parsed = parsePiReviewVerdict(JSON.stringify({ verdict: "APPROVED", summary: "Clean implementation.", specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] }, qualityAudit: { issues: [], strengths: ["Solid error handling"] } }));
    expect(parsed.verdict).toBe("APPROVED");
  });
  it("rejects markdown-wrapped or free-form approval", () => {
    expect(parsePiReviewVerdict("Everything looks great. [APPROVED]").verdict).toBe("NEEDS_REVISION");
    expect(parsePiReviewVerdict("```json { \"verdict\": \"APPROVED\" }```").verdict).toBe("NEEDS_REVISION");
  });
  it("rejects important and critical issues even with APPROVED verdict", () => {
    const parsed = parsePiReviewVerdict(JSON.stringify({ verdict: "APPROVED", summary: "Looks good.", specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] }, qualityAudit: { issues: [{ severity: "IMPORTANT", description: "Unsafe error handling" }], strengths: [] } }));
    expect(parsed.verdict).toBe("NEEDS_REVISION");
  });
  it("rejects malformed and incomplete responses", () => {
    expect(parsePiReviewVerdict("").verdict).toBe("NEEDS_REVISION");
    expect(parsePiReviewVerdict(JSON.stringify({ verdict: "APPROVED" })).verdict).toBe("NEEDS_REVISION");
  });
  it("maintains parse alias", () => expect(parseReviewVerdict).toBe(parsePiReviewVerdict));

  it("blocks review when deterministic verification fails", async () => {
    mockHandler = (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: "APPROVED", summary: "Perfect.", specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] }, qualityAudit: { issues: [], strengths: [] } }) } }] })); };
    const result = await runPiReview({ cwd: process.cwd(), brief: "Ensure authentication works", diff: "change", testCommand: "node -e 'process.exit(1)'", endpoint: mockEndpoint });
    expect(result.testResults?.passed).toBe(false); expect(result.verification?.passed).toBe(false); expect(result.verdict).toBe("NEEDS_REVISION");
  });

  it("preserves APPROVED when deterministic verification and review both pass", async () => {
    mockHandler = (_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: "APPROVED", summary: "Everything passes nicely.", specCompliance: { compliant: true, missingRequirements: [], unrequestedChanges: [] }, qualityAudit: { issues: [], strengths: ["Clean"] } }) } }] })); };
    const result = await runPiReview({ cwd: process.cwd(), brief: "Ensure tests pass", diff: "change", testCommand: "node -e 'process.exit(0)'", endpoint: mockEndpoint });
    expect(result.testResults?.passed).toBe(true); expect(result.verification?.passed).toBe(true); expect(result.verdict).toBe("APPROVED"); expect(result.summary).toBe("Everything passes nicely.");
  });

  it("fails closed when the review endpoint is unavailable", async () => {
    const result = await runPiReview({ cwd: process.cwd(), brief: "Test endpoint fallback", diff: "change", endpoint: "http://127.0.0.1:1" });
    expect(result.verdict).toBe("NEEDS_REVISION"); expect(result.summary).toContain("Reviewer returned");
  });
  it("maintains run alias", () => expect(runDshReview).toBe(runPiReview));
});
