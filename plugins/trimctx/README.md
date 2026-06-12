# trimctx Claude Code Plugin

This plugin adds Claude Code slash commands that call the local `trimctx` CLI.

## Commands

- `/trimctx` — analyze the most recent Claude Code or Codex JSONL session via `trimctx current --source auto --color`.
- `/trimctx:analyze <file>` — analyze a specific JSONL session file.
- `/trimctx:resume` — analyze the most recent Claude Code session.
- `/trimctx:compress` — write a safe compressed copy of the most recent session to `trimmed.jsonl`.

## Requirements

Install the CLI first so `trimctx` is available on `PATH`:

```bash
npm install -g trimctx
```

For local development from this repository, run:

```bash
npm install
npm run build
npm link
```

The commands do not modify original session files by default. Compression is only triggered by `/trimctx:compress` or an explicit `trimctx current --compress <output.jsonl>` command.

## Safety boundary

The plugin is a thin local wrapper around the CLI. It does not upload session data. It also does not automatically redact secrets from local reports or compressed artifacts, so review generated files before sharing them. `/trimctx` selects the latest local JSONL file by modification time; it is not a live-client current-session API.
