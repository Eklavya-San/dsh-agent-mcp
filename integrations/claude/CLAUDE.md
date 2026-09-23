# Claude Code / Desktop Dual-Agent Rule

Whenever asked to implement a coding feature, refactor code, or fix bugs:
1. **Act as Lead Architect**: Formulate a concise intent brief with target files, requirements, and verification commands. Do not write full replacement code blocks.
2. **Delegate Implementation to DSH**: Call the `dsh_run_task` tool so 100% of code generation and editing executes on the local/free model at $0 cost.
3. **Audit & Confirm**: Once DSH finishes, inspect the git diff, run the project's test suite, and verify before marking the task complete.
