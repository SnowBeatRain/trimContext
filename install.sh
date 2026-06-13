#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${TRIMCTX_REPO_URL:-https://github.com/SnowBeatRain/trimContext.git}"
REF="${TRIMCTX_REF:-main}"
INSTALL_DIR="${TRIMCTX_INSTALL_DIR:-$HOME/.local/share/trimctx}"
BIN_DIR="${TRIMCTX_BIN_DIR:-$HOME/.local/bin}"
CLAUDE_PLUGIN_DIR="${TRIMCTX_CLAUDE_PLUGIN_DIR:-$HOME/.claude/plugins/trimctx}"

info() {
  printf '[trimctx] %s\n' "$1"
}

fail() {
  printf '[trimctx] ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_command git
require_command node
require_command npm

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  fail "Node.js 20 or later is required. Current: $(node --version)"
fi

mkdir -p "$BIN_DIR" "$(dirname "$CLAUDE_PLUGIN_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --quiet FETCH_HEAD
else
  if [ -e "$INSTALL_DIR" ]; then
    fail "$INSTALL_DIR exists but is not a git checkout. Set TRIMCTX_INSTALL_DIR or remove it."
  fi
  info "Cloning $REPO_URL#$REF to $INSTALL_DIR"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

info "Installing dependencies"
npm --prefix "$INSTALL_DIR" install

info "Building CLI"
npm --prefix "$INSTALL_DIR" run build

info "Linking trimctx into $BIN_DIR"
ln -sfn "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/trimctx"
chmod +x "$INSTALL_DIR/dist/cli.js"

info "Installing Claude Code plugin into $CLAUDE_PLUGIN_DIR"
rm -rf "$CLAUDE_PLUGIN_DIR"
mkdir -p "$CLAUDE_PLUGIN_DIR"
cp -R "$INSTALL_DIR/plugins/trimctx/." "$CLAUDE_PLUGIN_DIR/"

if ! "$BIN_DIR/trimctx" --version >/dev/null; then
  fail "trimctx executable did not run after installation"
fi

cat <<EOF
[trimctx] Installed successfully.

CLI:
  $BIN_DIR/trimctx

Claude Code plugin:
  $CLAUDE_PLUGIN_DIR

If 'trimctx' is not found, add this to your shell profile:
  export PATH="$BIN_DIR:\$PATH"

Then restart Claude Code and run:
  /trimctx
EOF
