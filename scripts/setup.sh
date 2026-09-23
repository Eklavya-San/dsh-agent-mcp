#!/usr/bin/env bash
# setup.sh: Interactive 1-command installer for dsh-agent-mcp

set -e

echo "🚀 Installing dsh-agent-mcp..."

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is required. Please install Node.js >= 20."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "⚠️ Warning: Node.js version is < 20 (detected v$NODE_VERSION)."
fi

# 2. Build local repository if in source directory
if [ -f "package.json" ]; then
  echo "📦 Building dsh-agent-mcp from source..."
  npm install
  npm run build
fi

echo "✅ dsh-agent-mcp ready for configuration."
