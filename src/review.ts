import { execSync } from "child_process";
import http from "http";
import https from "https";
import { diffWorkerChanges, snapshotGit } from "./git.js";
import type { DshReviewOptions, DshReviewResult } from "./types.js";

export function formatReviewPrompt(options: DshReviewOptions): string {
  return `You are an expert code reviewer and QA verifier.
Audit this change against the architect's intent brief.

## ARCHITECT BRIEF:
${options.brief}

## GIT DIFF UNDER REVIEW:
${options.diff || "None"}

${options.testCommand ? `## TEST COMMAND:\n${options.testCommand}` : ""}

Return a strictly valid JSON object matching this schema:
{
  "verdict": "APPROVED" | "NEEDS_REVISION",
  "summary": "1-3 sentence evaluation",
  "specCompliance": {
    "compliant": boolean,
    "missingRequirements": string[],
    "unrequestedChanges": string[]
  },
  "qualityAudit": {
    "issues": [{"severity": "CRITICAL"|"IMPORTANT"|"MINOR", "description": string, "file": string}],
    "strengths": string[]
  }
}`;
}

export function parseReviewVerdict(rawText: string): DshReviewResult {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verdict: parsed.verdict === "APPROVED" ? "APPROVED" : "NEEDS_REVISION",
        summary: parsed.summary || "Review completed.",
        diffInspected: "",
        specCompliance: parsed.specCompliance || { compliant: parsed.verdict === "APPROVED", missingRequirements: [], unrequestedChanges: [] },
        qualityAudit: parsed.qualityAudit || { issues: [], strengths: [] },
      };
    }
  } catch {}

  const isApproved = /\[?APPROVED\]?/i.test(rawText) && !/NEEDS[ _-]?REVISION/i.test(rawText);
  return {
    verdict: isApproved ? "APPROVED" : "NEEDS_REVISION",
    summary: rawText.slice(0, 500),
    diffInspected: "",
    specCompliance: { compliant: isApproved, missingRequirements: [], unrequestedChanges: [] },
    qualityAudit: { issues: [], strengths: [] },
  };
}

export async function runDshReview(options: DshReviewOptions): Promise<DshReviewResult> {
  const { cwd, brief, testCommand } = options;

  // 1. Resolve diff if not provided
  let effectiveDiff = options.diff;
  if (!effectiveDiff) {
    const snapshot = snapshotGit(cwd);
    const diffResult = diffWorkerChanges(cwd, snapshot);
    effectiveDiff = diffResult.rawDiff || diffResult.diffSummary;
  }

  // 2. Run test command if specified
  let testExecResult: { command: string; passed: boolean; output: string } | undefined;
  if (testCommand) {
    try {
      const out = execSync(testCommand, { cwd, encoding: "utf-8", timeout: 120000 });
      testExecResult = { command: testCommand, passed: true, output: out.slice(0, 4000) };
    } catch (err: any) {
      testExecResult = { command: testCommand, passed: false, output: (err.stdout || err.message || "").slice(0, 4000) };
    }
  }

  // 3. Connect to local/free model endpoint
  const endpoint = options.endpoint || process.env.DSH_MODEL_ENDPOINT || process.env.OPENAI_BASE_URL || "http://localhost:11434/v1";
  const model = options.model || process.env.DSH_MODEL || process.env.OPENAI_MODEL_NAME || "qwen2.5-coder:32b";
  const prompt = formatReviewPrompt({ ...options, diff: effectiveDiff });

  let reviewResponse = "";
  try {
    const isHttps = endpoint.startsWith("https://");
    const client = isHttps ? https : http;
    const body = JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    const parsedUrl = new URL(`${endpoint.replace(/\/+$/, "")}/chat/completions`);
    reviewResponse = await new Promise<string>((resolve, reject) => {
      const req = client.request(
        parsedUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {}),
          },
          timeout: 45000,
        },
        (res) => {
          let data = "";
          res.on("data", chunk => (data += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(data);
              resolve(json.choices?.[0]?.message?.content || data);
            } catch {
              resolve(data);
            }
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Review request timed out"));
      });
      req.write(body);
      req.end();
    });
  } catch (err: any) {
    reviewResponse = `[Auto-Fallback]: Review connection to ${endpoint} failed (${err.message}). Defaulting to manual verification check.`;
  }

  const result = parseReviewVerdict(reviewResponse);
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
