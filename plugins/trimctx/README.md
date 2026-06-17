# trimctx Claude Code Plugin

This plugin adds Claude Code slash commands that call the local `trimctx` CLI.

## Commands

- `/trimctx` — analyze the most recent Claude Code or Codex JSONL session via `trimctx current --source auto --color`.
- `/trimctx:analyze <file>` — analyze a specific JSONL session file.
- `/trimctx:resume` — analyze the most recent Claude Code session.
- `/trimctx:compress` — write a safe compressed copy of the most recent session to `trimmed.jsonl`.

For handoff artifacts (not a slash command, use via CLI):

```bash
trimctx handoff <file.jsonl> -o handoff.md --next-context next-context.md
```

## Requirements

Node.js 20+ is required.

Install the CLI and Claude Code plugin from GitHub without publishing to npm.

Windows CMD:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex"
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex
```

macOS / Linux / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh | bash
```

Then restart Claude Code and run:

```text
/trimctx
```

For local development from this repository, run:

```bash
npm install
npm run build
npm link
mkdir -p ~/.claude/plugins
rm -rf ~/.claude/plugins/trimctx
cp -R plugins/trimctx ~/.claude/plugins/trimctx
```

The commands do not modify original session files by default. Compression is only triggered by `/trimctx:compress` or an explicit `trimctx current --compress <output.jsonl>` command.

## Safety boundary

The plugin is a thin local wrapper around the CLI. It does not upload session data. It also does not automatically redact secrets from local reports or compressed artifacts, so review generated files before sharing them. `/trimctx` selects the latest local JSONL file by modification time; it is not a live-client current-session API.
