---
name: dsh-orchestration
description: |
  Dual-Agent orchestration skill for delegating coding tasks to DeepSeek Harness (DSH) in headless or live mode,
  backed by local or free models at $0 cost, with automated review and QA verification.
---

# DeepSeek Harness (DSH) Dual-Agent Orchestration

## 1. Core Architecture & Workflow
Antigravity acts as the high-level Lead Architect, delegating mechanical coding tasks to **DeepSeek Harness (`@deepseek-ai/dsh`)**.
All heavy subagent inference runs at **$0 cost** through your configured local or free endpoint (Ollama, vLLM, FreeToken, LM Studio).

Every task follows a strict 2-agent sequence:
1. **Architect Prompting**: Concise (5–15 line) intent brief with target files, requirements, and verification commands.
2. **Agent 1 (Task Completion Worker)**: Dispatched via `dsh-worker` calling `dsh_run_task`. DSH reads files, writes code, edits components, and executes builds autonomously.
3. **Agent 2 (Reviewer & QA Verifier)**: Dispatched via `reviewer-worker` to audit git diffs, verify zero regressions, test independently, and confirm completion (`[CONFIRMED / APPROVED]`).

## 2. Dispatch Pattern
```json
{
  "Subagents": [
    {
      "TypeName": "dsh-worker",
      "Role": "Task Completion Worker",
      "Prompt": "CRITICAL: Do NOT edit files directly. Call dsh_run_task to execute via DeepSeek Harness at $0 cost.\n\nTask:\n- cwd: '<repo_path>'\n- brief: <concise high-level intent brief>\n- verification: npm test",
      "Model": "flash"
    }
  ]
}
```

Once Agent 1 completes:
```json
{
  "Subagents": [
    {
      "TypeName": "reviewer-worker",
      "Role": "Reviewer & QA Verifier",
      "Prompt": "Perform an independent audit and confirmation of the task completed by Agent 1.\n\nWorkspace: '<repo_path>'\nTask Brief: <original brief>\nChanged Files: <files touched>\n\nSteps:\n1. Inspect git diff.\n2. Verify code quality & no regressions.\n3. Run verification command.\n4. Deliver verdict: [CONFIRMED / APPROVED] or [NEEDS REVISION].",
      "Model": "flash"
    }
  ]
}
```
