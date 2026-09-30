# Google Antigravity Integration Guide

This directory contains the ready-to-use subagents, rules, and skills for Google Antigravity.

## Automated Setup (Recommended)

Run the installer from the root of `pi-agent-mcp`:
```bash
./scripts/setup.sh
```
This automatically copies the subagents, rules, and skills into your Antigravity configuration directory (`~/.gemini/config/`), and configures `mcp_config.json`.

---

## Manual Setup

If you prefer to configure Antigravity manually:

### 1. Copy Subagents
```bash
mkdir -p ~/.gemini/config/agents
cp integrations/antigravity/agents/*.md ~/.gemini/config/agents/
```
- `pi-worker.md`: Dispatches mechanical implementation to Pi Coding Agent (`pi_run_task`) at $0 token cost.
- `reviewer-worker.md`: Audits git diffs, verifies tests, runs `pi_review_task`, and provides an independent `[CONFIRMED / APPROVED]` QA gate.

### 2. Copy Dual-Agent Protocol Rule
```bash
mkdir -p ~/.gemini/config/rules
cp integrations/antigravity/rules/AGENTS.md ~/.gemini/config/rules/
```

### 3. Copy Orchestration Skill
```bash
mkdir -p ~/.gemini/config/skills/pi-orchestration
cp integrations/antigravity/skills/pi-orchestration/SKILL.md ~/.gemini/config/skills/pi-orchestration/
```

### 4. Register MCP Server
Add the following to `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "pi-agent": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/pi-agent-mcp/build/mcp.js"],
      "env": {
        "FREETOKEN_BASE_URL": "http://machinewiseapp.in:10346/v1",
        "PI_DEFAULT_PROVIDER": "freetoken"
      }
    }
  }
}
```
*(Replace `/ABSOLUTE/PATH/TO/pi-agent-mcp` with your actual checkout path)*
