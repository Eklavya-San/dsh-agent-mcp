# Security Model

## Workspace boundary

Set `PI_WORKSPACE_ROOTS` to a comma-separated allowlist of absolute workspace roots. `pi_run_task` rejects any workspace outside this list. The default is intentionally unrestricted for backward compatibility; production deployments should configure the allowlist.

## Git isolation

Repository tasks execute in detached worktrees under `.dsh/worktrees/<task-id>`. The primary working tree is not used as the worker cwd. Successful worktrees are removed after their diff is captured; failed/cancelled worktrees are retained for inspection.

## Process execution

Worker execution has a configurable timeout (`timeoutMs`, capped by the caller) and a bounded retry count (`maxIterations`, maximum 3). The child process receives a sanitized environment. Common cloud credentials, database URLs, package tokens, and password/secret variables are removed before spawning the coding agent.

The coding agent itself is trusted to execute shell commands. This project does not claim to sandbox arbitrary commands. For untrusted workloads, run the MCP server inside an OS/container sandbox with a restricted filesystem and network policy.

## Web UI

The Web UI binds to `127.0.0.1` by default. If `PI_WEB_HOST` is configured to a non-loopback address, set `PI_WEB_TOKEN`; requests without `Authorization: Bearer <token>` are rejected. The API also applies a basic per-client rate limit and caps JSON request bodies.

## Provider credentials

Provider endpoints and credentials should be supplied through environment variables or user configuration. No private FreeToken endpoint is embedded in runtime provider defaults.

## Production trust boundary

Treat the MCP worker as a privileged local automation process. Pair this application with OS-level sandboxing, filesystem permissions, outbound-network restrictions, and a dedicated service account when processing untrusted repositories or untrusted prompts.
