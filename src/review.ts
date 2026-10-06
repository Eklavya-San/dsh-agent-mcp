import { execSync } from "child_process";
import http from "http";
import https from "https";
import { diffWorkerChanges, snapshotGit } from "./git.js";
import { resolveProvider } from "./providers.js";
import type { DshReviewOptions, DshReviewResult, PiReviewOptions, PiReviewResult } from "./types.js";

export function formatPiReviewPrompt(options: PiReviewOptions): string {
  return `You are an expert code reviewer and QA verifier.
Audit this change against the architect's intent brief.

## ARCHITECT BRIEF:
${options.brief}

## GIT DIFF UNDER REVIEW:
${options.diff || "None"}

${options.testCommand ? `## TEST COMMAND:\n${options.testCommand}` : ""}

Return ONLY a strictly valid JSON object matching this schema:
{
  "verdict": "APPROVED" | "NEEDS_REVISION",
  "summary": "1-3 sentence evaluation",
  "specCompliance": { "compliant": boolean, "missingRequirements": string[], "unrequestedChanges": string[] },
  "qualityAudit": { "issues": [{"severity": "CRITICAL"|"IMPORTANT"|"MINOR", "description": string, "file": string}], "strengths": string[] }
}
Approval is allowed only when the schema is complete, verdict is APPROVED, specCompliance.compliant is true, and there are no CRITICAL or IMPORTANT issues.`;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parsePiReviewVerdict(rawText: string): PiReviewResult {
  const failClosed = (summary: string): PiReviewResult => ({
    verdict: "NEEDS_REVISION",
    summary: summary || "Reviewer response was invalid or incomplete; approval is blocked.",
    diffInspected: "",
    specCompliance: { compliant: false, missingRequirements: [], unrequestedChanges: [] },
    qualityAudit: { issues: [{ severity: "CRITICAL", description: "Reviewer response did not satisfy the required structured schema.", file: "" }], strengths: [] },
  });

  try {
    const parsed = JSON.parse(rawText.trim());
    if (!parsed || typeof parsed !== "object") return failClosed("Reviewer returned a non-object response.");
    if (parsed.verdict !== "APPROVED" && parsed.verdict !== "NEEDS_REVISION") return failClosed("Reviewer returned an invalid verdict.");
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) return failClosed("Reviewer response is missing summary.");
    if (!parsed.specCompliance || typeof parsed.specCompliance.compliant !== "boolean" || !validStringArray(parsed.specCompliance.missingRequirements) || !validStringArray(parsed.specCompliance.unrequestedChanges)) return failClosed("Reviewer response has incomplete specCompliance data.");
    if (!parsed.qualityAudit || !validStringArray(parsed.qualityAudit.strengths) || !Array.isArray(parsed.qualityAudit.issues)) return failClosed("Reviewer response has incomplete qualityAudit data.");

    const issues = parsed.qualityAudit.issues.filter((issue: any) => issue && typeof issue.description === "string");
    if (issues.length !== parsed.qualityAudit.issues.length || issues.some((issue: any) => !["CRITICAL", "IMPORTANT", "MINOR"].includes(issue.severity))) return failClosed("Reviewer response contains invalid quality issue entries.");

    const blockingIssue = issues.some((issue: any) => issue.severity === "CRITICAL" || issue.severity === "IMPORTANT");
    const approved = parsed.verdict === "APPROVED" && parsed.specCompliance.compliant && !blockingIssue;
    return {
      verdict: approved ? "APPROVED" : "NEEDS_REVISION",
      summary: parsed.summary,
      diffInspected: "",
      specCompliance: parsed.specCompliance,
      qualityAudit: { issues, strengths: parsed.qualityAudit.strengths },
    };
  } catch {
    return failClosed("Reviewer returned malformed JSON; approval is blocked.");
  }
}

export async function runPiReview(options: PiReviewOptions & { endpoint?: string; apiKey?: string }): Promise<PiReviewResult> {
  const { cwd, brief, testCommand } = options;
  let effectiveDiff = options.diff;
  if (!effectiveDiff) {
    const snapshot = snapshotGit(cwd);
    const diffResult = diffWorkerChanges(cwd, snapshot);
    effectiveDiff = diffResult.rawDiff || diffResult.diffSummary;
  }

  let testExecResult: { command: string; passed: boolean; output: string } | undefined;
  if (testCommand) {
    try {
      const out = execSync(testCommand, { cwd, encoding: "utf-8", timeout: 120000 });
      testExecResult = { command: testCommand, passed: true, output: out.slice(0, 4000) };
    } catch (err: any) {
      testExecResult = { command: testCommand, passed: false, output: String(err.stdout || err.stderr || err.message || "").slice(0, 4000) };
    }
  }

  const provider = resolveProvider(options.provider);
  const endpoint = options.endpoint || provider.baseUrl;
  const model = options.model || provider.defaultModel;
  const prompt = formatPiReviewPrompt({ ...options, diff: effectiveDiff });
  let reviewResponse = "";

  try {
    const parsedUrl = new URL(`${endpoint.replace(/\/+$/, "")}/chat/completions`);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const body = JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.1 });
    const authVal = options.apiKey || provider.apiKey;
    const authHeader = provider.authHeader || (authVal ? `Bearer ${authVal}` : process.env.OPENAI_API_KEY ? `Bearer ${process.env.OPENAI_API_KEY}` : undefined);

    reviewResponse = await new Promise<string>((resolve, reject) => {
      const req = client.request(parsedUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(authHeader ? { Authorization: authHeader } : {}) },
        timeout: 45000,
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Review provider returned HTTP ${res.statusCode}`));
          try {
            const json = JSON.parse(data);
            resolve(json.choices?.[0]?.message?.content || "");
          } catch { resolve(""); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("Review request timed out")); });
      req.write(body); req.end();
    });
  } catch (err: any) {
    reviewResponse = "";
  }

  const result = parsePiReviewVerdict(reviewResponse);
  result.diffInspected = (effectiveDiff || "").slice(0, 4000);
  if (testExecResult) {
    result.testResults = testExecResult;
    if (!testExecResult.passed) {
      result.verdict = "NEEDS_REVISION";
      result.summary += ` [Tests Failed: ${testCommand}]`;
    }
  }
  return result;
}

export const formatReviewPrompt = formatPiReviewPrompt;
export const parseReviewVerdict = parsePiReviewVerdict;
export const runDshReview = runPiReview;
