#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${TRIMCTX_REPO_URL:-https://github.com/SnowBeatRain/trimContext.git}"
REF="${TRIMCTX_REF:-main}"
INSTALL_DIR="${TRIMCTX_INSTALL_DIR:-$HOME/.local/share/trimctx}"
BIN_DIR="${TRIMCTX_BIN_DIR:-$HOME/.local/bin}"
CLAUDE_PLUGIN_DIR="${TRIMCTX_CLAUDE_PLUGIN_DIR:-$HOME/.claude/plugins/trimctx}"
MARKER_NAME=".trimctx-install-marker"
MARKER_CONTENT="trimctx-plugin-v1"

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

resolve_safe_target() {
  local value="$1"
  local label="$2"
  [ -n "$value" ] || fail "Refusing to use an empty $label."
  if [[ "$value" =~ [[:cntrl:]] ]]; then
    fail "Refusing to use a $label containing control characters."
  fi

  local resolved
  resolved="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$value")" \
    || fail "Unable to resolve $label."
  [ "$resolved" != "/" ] || fail "Refusing to use the filesystem root as $label."

  local resolved_home
  resolved_home="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$HOME")" \
    || fail "Unable to resolve the user home."
  [ "$resolved" != "$resolved_home" ] || fail "Refusing to use the user home as $label."
  printf '%s' "$resolved"
}

assert_not_symlink() {
  local path="$1"
  local label="$2"
  [ ! -L "$path" ] || fail "Refusing to replace a symlink $label: $path"
}

assert_owned_checkout() {
  local path="$1"
  [ ! -e "$path" ] && return
  assert_not_symlink "$path" "install directory"
  [ -d "$path" ] && [ -e "$path/.git" ] \
    || fail "Install directory exists but is not a trimctx git checkout: $path"

  local top_level
  top_level="$(git -C "$path" rev-parse --show-toplevel 2>/dev/null)" \
    || fail "Install directory is not a readable git checkout: $path"
  top_level="$(resolve_safe_target "$top_level" "git checkout root")"
  [ "$top_level" = "$path" ] || fail "Install directory is not the git checkout root: $path"

  local origin
  origin="$(git -C "$path" remote get-url origin 2>/dev/null)" \
    || fail "Install directory git origin is unavailable: $path"
  [ "$origin" = "$REPO_URL" ] \
    || fail "Install directory git origin does not match the requested repository: $path"
}

trimctx_marker_valid() {
  local path="$1/$MARKER_NAME"
  [ -f "$path" ] || return 1
  [ "$(cat "$path")" = "$MARKER_CONTENT" ]
}

legacy_trimctx_plugin() {
  local path="$1"
  [ -f "$path/.claude-plugin/plugin.json" ] \
    && [ -f "$path/.system" ] \
    && [ -f "$path/commands/trimctx.md" ]
}

assert_owned_plugin() {
  local path="$1"
  [ ! -e "$path" ] && return
  assert_not_symlink "$path" "Claude plugin directory"
  [ -d "$path" ] || fail "Claude plugin target exists but is not a directory: $path"

  if [ -e "$path/$MARKER_NAME" ]; then
    trimctx_marker_valid "$path" \
      || fail "Claude plugin marker does not match trimctx ownership: $path"
    return
  fi
  legacy_trimctx_plugin "$path" \
    || fail "Claude plugin directory is not owned by trimctx: $path"
}

require_command git
require_command node
require_command npm

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  fail "Node.js 20 or later is required. Current: $(node --version)"
fi

INSTALL_DIR="$(resolve_safe_target "$INSTALL_DIR" "install directory")"
BIN_DIR="$(resolve_safe_target "$BIN_DIR" "binary directory")"
CLAUDE_PLUGIN_DIR="$(resolve_safe_target "$CLAUDE_PLUGIN_DIR" "Claude plugin directory")"
assert_owned_checkout "$INSTALL_DIR"
assert_owned_plugin "$CLAUDE_PLUGIN_DIR"

mkdir -p "$(dirname "$INSTALL_DIR")" "$BIN_DIR" "$(dirname "$CLAUDE_PLUGIN_DIR")"

if [ -e "$INSTALL_DIR" ]; then
  info "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --quiet FETCH_HEAD
else
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
assert_owned_plugin "$CLAUDE_PLUGIN_DIR"
if [ -e "$CLAUDE_PLUGIN_DIR" ]; then
  rm -rf -- "$CLAUDE_PLUGIN_DIR"
fi
mkdir -p "$CLAUDE_PLUGIN_DIR"
cp -R "$INSTALL_DIR/plugins/trimctx/." "$CLAUDE_PLUGIN_DIR/"
trimctx_marker_valid "$CLAUDE_PLUGIN_DIR" \
  || fail "Installed Claude plugin is missing the trimctx ownership marker: $CLAUDE_PLUGIN_DIR"

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
