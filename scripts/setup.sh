#!/usr/bin/env bash
# setup.sh: Automated 1-command installer and environment configurator for dsh-agent-mcp

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_SERVER_PATH="${REPO_DIR}/build/mcp.js"

echo "=========================================================="
echo "⚡ dsh-agent-mcp: Automated Setup & Configurator"
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

# 2. Build local repository from source
echo "📦 Installing dependencies and compiling TypeScript..."
cd "${REPO_DIR}"
npm install
npm run build
echo "✅ Build completed successfully (${MCP_SERVER_PATH})."

# 3. Check or initialize ~/.dsh/settings.yaml
DSH_DIR="${HOME}/.dsh"
DSH_SETTINGS="${DSH_DIR}/settings.yaml"

if [ ! -f "${DSH_SETTINGS}" ]; then
  echo "⚙️  Initializing default DeepSeek Harness settings in ${DSH_SETTINGS}..."
  mkdir -p "${DSH_DIR}"
  cat << 'EOF' > "${DSH_SETTINGS}"
ui-theme:
  preference: dark

agent-default-model:
  provider: ollama
  model: qwen2.5-coder:32b

providers:
  ollama:
    api: openai-completions
    baseURL: http://localhost:11434/v1
    models:
      - id: qwen2.5-coder:32b
        name: Qwen 2.5 Coder 32B
      - id: qwen3.8:27b
        name: Qwen 3.8 27B
    apiKeyEnv: OLLAMA_API_KEY
EOF
  echo "✅ Created starter ~/.dsh/settings.yaml (configured for Ollama at http://localhost:11434/v1)."
else
  echo "ℹ️  Found existing ~/.dsh/settings.yaml."
fi

# 4. Check for DSH binary
if command -v dsh >/dev/null 2>&1; then
  echo "✅ DeepSeek Harness binary found in PATH: $(which dsh)"
elif [ -n "${DSH_BIN}" ] && [ -x "${DSH_BIN}" ]; then
  echo "✅ DeepSeek Harness binary configured via DSH_BIN: ${DSH_BIN}"
else
  echo "ℹ️  Note: 'dsh' binary not found in PATH."
  echo "   If you have a local dsh installation, you can set:"
  echo "   export DSH_BIN=\"/path/to/dsh\""
fi

# 5. Antigravity IDE Integration Auto-Install
ANTIGRAVITY_CONFIG="${HOME}/.gemini/config"
if [ -d "${HOME}/.gemini" ]; then
  echo ""
  echo "🤖 Google Antigravity detected. Installing dual-agent integrations..."
  mkdir -p "${ANTIGRAVITY_CONFIG}/agents"
  mkdir -p "${ANTIGRAVITY_CONFIG}/rules"
  mkdir -p "${ANTIGRAVITY_CONFIG}/skills/dsh-orchestration"

  # Copy agents
  cp -f "${REPO_DIR}/integrations/antigravity/agents/"*.md "${ANTIGRAVITY_CONFIG}/agents/" 2>/dev/null || true
  # Copy rules
  cp -f "${REPO_DIR}/integrations/antigravity/rules/AGENTS.md" "${ANTIGRAVITY_CONFIG}/rules/" 2>/dev/null || true
  # Copy skill
  cp -f "${REPO_DIR}/integrations/antigravity/skills/dsh-orchestration/SKILL.md" "${ANTIGRAVITY_CONFIG}/skills/dsh-orchestration/" 2>/dev/null || true

  echo "✅ Installed dsh-worker and reviewer-worker subagents into ${ANTIGRAVITY_CONFIG}/"
  echo "✅ Installed AGENTS.md dual-agent rule into ${ANTIGRAVITY_CONFIG}/rules/"
  echo "✅ Installed dsh-orchestration skill into ${ANTIGRAVITY_CONFIG}/skills/"
fi

echo ""
echo "=========================================================="
echo "🎉 Setup complete! Add dsh-agent-mcp to your AI tools:"
echo "=========================================================="
echo ""
echo "👉 For Antigravity (~/.gemini/config/mcp_config.json):"
cat << EOF
{
  "mcpServers": {
    "dsh": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "DSH_MODEL_ENDPOINT": "http://localhost:11434/v1",
        "DSH_MODEL": "qwen2.5-coder:32b"
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
    "dsh": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "DSH_MODEL_ENDPOINT": "http://localhost:11434/v1",
        "DSH_MODEL": "qwen2.5-coder:32b"
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
    "dsh": {
      "command": "node",
      "args": ["${MCP_SERVER_PATH}"],
      "env": {
        "DSH_MODEL_ENDPOINT": "http://localhost:11434/v1",
        "DSH_MODEL": "qwen2.5-coder:32b"
      }
    }
  }
}
EOF
echo ""
echo "To verify server health anytime, run: npm run doctor"
