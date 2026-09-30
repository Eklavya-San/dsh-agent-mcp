#!/usr/bin/env bash
# setup.sh: Automated 1-command installer and environment configurator for pi-agent-mcp

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_SERVER_PATH="${REPO_DIR}/build/mcp.js"

echo "=========================================================="
echo "⚡ pi-agent-mcp: Automated Setup & Configurator"
echo "=========================================================="

# 1. Check Node.js runtime
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is required. Please install Node.js >= 20."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️  Warning: Node.js version is < 20 (detected $(node -v)). Node 20+ is recommended."
fi

# 2. Check for Pi CLI binary
if command -v pi >/dev/null 2>&1; then
  echo "✅ Pi binary found in PATH: $(which pi) ($(pi --version 2>/dev/null || true))"
elif [ -n "${PI_BIN}" ] && [ -x "${PI_BIN}" ]; then
  echo "✅ Pi binary configured via PI_BIN: ${PI_BIN}"
else
  echo "⚠️  Warning: 'pi' binary not found in PATH."
  echo "   Please install pi CLI (e.g. npm install -g @mako10k/pi or ensure it is in PATH)."
  echo "   Or set: export PI_BIN=\"/path/to/pi\""
fi

# 3. Build local repository from source
echo "📦 Installing dependencies and compiling TypeScript..."
cd "${REPO_DIR}"
npm install
npm run build
echo "✅ Build completed successfully (${MCP_SERVER_PATH})."

# 4. Make CLI and helper binaries executable
chmod +x "${REPO_DIR}/bin/pi-live" "${REPO_DIR}/bin/pi-stream.js" 2>/dev/null || true
if [ -f "${REPO_DIR}/bin/dsh-live" ]; then
  chmod +x "${REPO_DIR}/bin/dsh-live" "${REPO_DIR}/bin/dsh-stream.js" 2>/dev/null || true
fi
echo "✅ CLI binaries configured with executable permissions."

# 5. Antigravity IDE Integration Auto-Install
ANTIGRAVITY_CONFIG="${HOME}/.gemini/config"
if [ -d "${HOME}/.gemini" ]; then
  echo ""
  echo "🤖 Google Antigravity detected. Installing dual-agent integrations..."
  mkdir -p "${ANTIGRAVITY_CONFIG}/agents"
  mkdir -p "${ANTIGRAVITY_CONFIG}/rules"
  mkdir -p "${ANTIGRAVITY_CONFIG}/skills/pi-orchestration"

  # Clean up legacy dsh-orchestration skill if present
  rm -rf "${ANTIGRAVITY_CONFIG}/skills/dsh-orchestration"

  # Copy agents
  cp -f "${REPO_DIR}/integrations/antigravity/agents/"*.md "${ANTIGRAVITY_CONFIG}/agents/" 2>/dev/null || true
  # Copy rules
  cp -f "${REPO_DIR}/integrations/antigravity/rules/AGENTS.md" "${ANTIGRAVITY_CONFIG}/rules/" 2>/dev/null || true
  # Copy skill
  cp -f "${REPO_DIR}/integrations/antigravity/skills/pi-orchestration/SKILL.md" "${ANTIGRAVITY_CONFIG}/skills/pi-orchestration/" 2>/dev/null || true

  echo "✅ Installed pi-worker and reviewer-worker subagents into ${ANTIGRAVITY_CONFIG}/agents/"
  echo "✅ Installed AGENTS.md dual-agent rule into ${ANTIGRAVITY_CONFIG}/rules/"
  echo "✅ Installed pi-orchestration skill into ${ANTIGRAVITY_CONFIG}/skills/"

  # Update Antigravity mcp_config.json automatically if present
  MCP_CONFIG="${ANTIGRAVITY_CONFIG}/mcp_config.json"
  if [ -f "${MCP_CONFIG}" ]; then
    echo "🔧 Updating Antigravity MCP config to register pi-agent and dsh..."
    node -e "
      const fs = require('fs');
      const p = '${MCP_CONFIG}';
      let cfg = {};
      try {
        cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (err) {
        cfg = {};
      }
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers['pi-agent'] = {
        command: 'node',
        args: ['${MCP_SERVER_PATH}'],
        env: {
          FREETOKEN_BASE_URL: 'http://machinewiseapp.in:10346/v1',
          PI_DEFAULT_PROVIDER: 'freetoken'
        }
      };
      cfg.mcpServers.dsh = {
        command: 'node',
        args: ['${MCP_SERVER_PATH}'],
        env: {
          DSH_MODEL_ENDPOINT: 'http://localhost:11434/v1',
          DSH_MODEL: 'qwen2.5-coder:32b'
        }
      };
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
    "
    echo "✅ Updated ${MCP_CONFIG} with active build path."
  fi
fi

echo ""
echo "=========================================================="
echo "🎉 Setup complete! Add pi-agent-mcp to your AI tools:"
echo "=========================================================="
echo ""
echo "👉 For Antigravity (~/.gemini/config/mcp_config.json):"
cat << EOF
{
  "mcpServers": {
    "pi-agent": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "FREETOKEN_BASE_URL": "http://machinewiseapp.in:10346/v1",
        "PI_DEFAULT_PROVIDER": "freetoken"
      }
    }
  }
}
EOF
echo ""
echo "👉 For Claude Desktop (claude_desktop_config.json):"
cat << EOF
{
  "mcpServers": {
    "pi-agent": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "FREETOKEN_BASE_URL": "http://machinewiseapp.in:10346/v1",
        "PI_DEFAULT_PROVIDER": "freetoken"
      }
    }
  }
}
EOF
echo ""
echo "👉 For Cursor (.cursor/mcp.json):"
cat << EOF
{
  "mcpServers": {
    "pi-agent": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "FREETOKEN_BASE_URL": "http://machinewiseapp.in:10346/v1",
        "PI_DEFAULT_PROVIDER": "freetoken"
      }
    }
  }
}
EOF
echo ""
echo "To verify server health anytime, run: npm run doctor"
