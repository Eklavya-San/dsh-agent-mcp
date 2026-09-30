---
name: pi-orchestration
description: |
  Dual-Agent orchestration skill for delegating coding tasks to Pi coding agent in headless or live mode,
  backed by local or free models at $0 cost, with automated review and QA verification.
---

# Pi Coding Agent Dual-Agent Orchestration

## 1. Core Architecture & Workflow
Antigravity acts as the high-level Lead Architect, delegating mechanical coding tasks to **Pi Coding Agent (`pi-agent-mcp` / `pi`)**.
All heavy subagent inference runs at **$0 cost** through configured local or free endpoints (FreeToken Qwen 35B, NVIDIA NIM, Ollama, OpenRouter).

Every task follows a strict 2-agent sequence:
1. **Architect Prompting**: Concise (5–15 line) intent brief with target files, requirements, and verification commands.
2. **Agent 1 (Task Completion Worker)**: Dispatched via `pi-worker` calling `pi_run_task` or running `bin/pi-live` in a terminal. Pi reads files, writes code, edits components, and executes builds autonomously.
3. **Agent 2 (Reviewer & QA Verifier)**: Dispatched via `reviewer-worker` to audit git diffs, verify zero regressions, test independently (or call `pi_review_task`), and confirm completion (`[CONFIRMED / APPROVED]`).

## 2. Dispatch Pattern

### Agent 1: Task Completion Worker
```json
{
  "Subagents": [
    {
      "TypeName": "pi-worker",
      "Role": "Task Completion Worker",
      "Prompt": "CRITICAL: Do NOT edit files directly. Call pi_run_task to execute via Pi Coding Agent at $0 cost.\n\nTask:\n- cwd: '<repo_path>'\n- brief: <concise high-level intent brief>\n- verification: npm test",
      "Model": "flash"
    }
  ]
}
```

### Agent 2: Reviewer & QA Verifier
Once Agent 1 completes:
```json
{
  "Subagents": [
    {
      "TypeName": "reviewer-worker",
      "Role": "Reviewer & QA Verifier",
      "Prompt": "Perform an independent audit and confirmation of the task completed by Agent 1.\n\nWorkspace: '<repo_path>'\nTask Brief: <original brief>\nChanged Files: <files touched>\n\nSteps:\n1. Inspect git diff.\n2. Verify code quality & no regressions.\n3. Run verification command or call pi_review_task.\n4. Deliver verdict: [CONFIRMED / APPROVED] or [NEEDS REVISION].",
      "Model": "flash"
    }
  ]
}
```

## 3. Live Interactive Mode
When live visibility in the terminal panel is preferred, launch `bin/pi-live "<prompt>"` in a terminal window. It streams thinking and tool output with full ANSI color in real time while mirroring markdown to `.pi-live.md`.

## 4. Backward Compatibility
All previous `dsh_*` tools (`dsh_run_task`, `dsh_doctor`, `dsh_cancel_task`, `dsh_list_active_tasks`, `dsh_review_task`) are maintained as backward-compatible aliases to their `pi_*` counterparts.
