# Google Antigravity Integration Guide

This directory contains the ready-to-use subagents, rules, and skills for Google Antigravity.

## Automated Setup (Recommended)

Run the installer from the root of `dsh-agent-mcp`:
```bash
./scripts/setup.sh
```
This automatically copies the subagents, rules, and skills into your Antigravity configuration directory (`~/.gemini/config/`).

---

## Manual Setup

If you prefer to configure Antigravity manually:

### 1. Copy Subagents
```bash
mkdir -p ~/.gemini/config/agents
cp integrations/antigravity/agents/*.md ~/.gemini/config/agents/
```
- `dsh-worker.md`: Dispatches mechanical implementation to DeepSeek Harness (`dsh_run_task`) at $0 token cost.
- `reviewer-worker.md`: Audits git diffs, verifies tests, and provides an independent `[CONFIRMED / APPROVED]` QA gate.

### 2. Copy Dual-Agent Protocol Rule
```bash
mkdir -p ~/.gemini/config/rules
cp integrations/antigravity/rules/AGENTS.md ~/.gemini/config/rules/
```

### 3. Copy Orchestration Skill
```bash
mkdir -p ~/.gemini/config/skills/dsh-orchestration
cp integrations/antigravity/skills/dsh-orchestration/SKILL.md ~/.gemini/config/skills/dsh-orchestration/
```

### 4. Register MCP Server
Add the following to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "dsh": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/dsh-agent-mcp/build/mcp.js"],
      "env": {
        "DSH_MODEL_ENDPOINT": "http://localhost:11434/v1",
        "DSH_MODEL": "qwen2.5-coder:32b"
      }
    }
  }
}
```
*(Replace `/ABSOLUTE/PATH/TO/dsh-agent-mcp` with your actual checkout path)*
