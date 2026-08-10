# trimctx Claude Code plugin

Analyze the current Claude Code JSONL conversation from inside Claude Code.

## Commands

- `/trimctx` - analyze the current Claude Code session when `TRIMCTX_TRANSCRIPT_PATH` is available.
- `/trimctx:analyze` - analyze an explicitly provided JSONL file path.
- `/trimctx:export` - export the current Claude Code session to `conversation.md` as parser-normalized Markdown.
- `/trimctx:new-chat` - create a UID-based new-chat package for the current Claude Code session.
- `/trimctx:compress` - only when the user explicitly asks to write a compressed copy.

## Safety

- Reads local JSONL exports only.
- Does not call an external LLM or upload transcript content.
- Does not modify original session files.
- Compression requires explicit user action and writes a separate output file.
- Compression rejects duplicate normalized message IDs before creating or replacing its output.
- Current-window commands require Claude hooks. Enable them explicitly with `trimctx init --with-hooks`.
- Installed hook commands use absolute Node and packaged `dist/cli.js` paths resolved at installation time. Rerun `trimctx init --with-hooks --force` after either path moves; stale trimctx-managed hook paths are replaced without removing unrelated hooks.
- `/trimctx` and `/trimctx:export` require the current-window hook binding and never fall back to latest-file discovery.
- `/trimctx:export` writes `conversation.md`; the parser-normalized output is unredacted and must be reviewed before sharing.
- SessionStart writes the current binding through `CLAUDE_ENV_FILE`.
- Stop may update only the trimctx-managed block in the project's `.claude/CLAUDE.md`.
- Hooks keep the original JSONL transcript read-only.
- Automatic hook stdin is limited to 1 MiB; Stop transcripts are limited to 64 MiB and 10,000 normalized messages. Explicit CLI commands are not subject to these hook-only limits.

## Multiple Claude Windows

- Each window's SessionStart hook receives that session's `transcript_path` and `session_id` and writes them through that window's own `CLAUDE_ENV_FILE`.
- Restart every open Claude Code window after installing hooks so each window receives its own binding.
- Current-window commands use `TRIMCTX_TRANSCRIPT_PATH`; do not substitute `--latest` when several windows are open.
- Windows in the same project share `.claude/CLAUDE.md`, so its managed status block may reflect the window whose Stop hook ran last. This does not change per-window transcript bindings.

## Requirements

Node.js 20+ is required.

Install the `trimctx` CLI before using these command files.

For installation steps and local development workflow, see the repository `README.md` or `docs/user/usage.md`.
