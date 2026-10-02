# Autonomous Dual-Agent Execution Rules (On-Demand)

## Architecture: Lead Architect & Dual-Agent Protocol
The Dual-Agent Protocol (`pi-worker` / `pi-agent` / `pi-live` / `dsh`) is an **on-demand execution mode**.

- **Default Behavior**: Antigravity performs code generation, file edits, and verification directly using standard tools.
- **On-Demand Activation**: The two-agent protocol is ONLY activated when:
  1. The user explicitly requests Pi, DSH, Pi Live, FreeToken, or $0 cost subagent execution (e.g., "use pi", "run with pi-live", "run pi task", "use dsh", "freetoken").
  2. The `pi-orchestration`, `pi-worker-orchestration`, or `freetoken-subagent` skill is explicitly invoked or requested.

When explicitly activated by the user, follow the protocol:

1. **Lead Architect (Frontier Model / Primary Agent)**:
   - Formulates a concise (5–15 line) intent-based brief:
     - Target file(s) and directories
     - Goals and requirements
     - Invariants (state/props preservation)
     - Verification command (e.g., `npm test`, `yarn build`)
   - Avoid pre-writing code blocks or spoon-feeding line-by-line replacements; let the subagent inspect the files and write the code.

2. **Agent 1: Task Completion Worker (`pi-worker` / `pi-agent`)**:
   - Executes the code generation, file edits, and initial verification strictly via `pi-live` (in terminal panel for live visibility) or `pi_run_task` at $0 cost on FreeToken Qwen 35B (or configured local/free model backend).
   - Runs in an isolated context window with 0 token leakage.
   - Reports modified files and git diff summary upon completion.

3. **Agent 2: Reviewer & QA Verifier (`reviewer-worker`)**:
   - Invoked immediately after Agent 1 completes.
   - Rigorously inspects the git diff and modified files for correctness, regressions, and quality standards.
   - Independently runs the build/test suite or invokes `pi_review_task`.
   - Delivers a definitive verdict: `[CONFIRMED / APPROVED]` or `[NEEDS REVISION]`.
   - A task is ONLY declared complete once Agent 2 confirms and approves it.

4. **Lifecycle Disposal & Zero-Leakage**:
   - Both subagent processes terminate immediately upon completion.
   - No stale tokens or idle memory bleed into subsequent tasks.
