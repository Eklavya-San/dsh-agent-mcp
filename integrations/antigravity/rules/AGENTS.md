# Autonomous Dual-Agent Execution Rules

## Architecture: Lead Architect & Dual-Agent Protocol
Every non-trivial coding task MUST follow the two-agent protocol:

1. **Lead Architect (Frontier Model / Primary Agent)**:
   - Formulates a concise (5–15 line) intent-based brief:
     - Target file(s) and directories
     - Goals and requirements
     - Invariants (state/props preservation)
     - Verification command (e.g., `npm test`, `yarn build`)
   - **BANNED**: Never pre-write code blocks or spoon-feed line-by-line replacements. Let the subagent inspect the files and write the code.

2. **Agent 1: Task Completion Worker (`dsh-worker`)**:
   - Executes 100% of the code generation, file edits, and initial verification strictly via `dsh_run_task` on your local/free model backend.
   - Runs in an isolated context window with 0 token leakage.
   - Reports modified files and git diff summary upon completion.

3. **Agent 2: Reviewer & QA Verifier (`reviewer-worker`)**:
   - Invoked immediately after Agent 1 completes.
   - Rigorously inspects the git diff and modified files for correctness, regressions, and quality standards.
   - Independently runs the build/test suite.
   - Delivers a definitive verdict: `[CONFIRMED / APPROVED]` or `[NEEDS REVISION]`.
   - A task is ONLY declared complete once Agent 2 confirms and approves it.

4. **Lifecycle Disposal & Zero-Leakage**:
   - Both subagent processes terminate immediately upon completion.
   - No stale tokens or idle memory bleed into subsequent tasks.
