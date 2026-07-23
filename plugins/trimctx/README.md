# trimctx Claude Code plugin

Analyze the current Claude Code JSONL conversation from inside Claude Code.

## Commands

- `/trimctx` - analyze the current Claude Code session when `TRIMCTX_TRANSCRIPT_PATH` is available.
- `/trimctx:analyze` - analyze an explicitly provided JSONL file path.
- `/trimctx:new-chat` - create a UID-based new-chat package for the current Claude Code session.
- `/trimctx:compress` - only when the user explicitly asks to write a compressed copy.

## Safety

- Reads local JSONL exports only.
- Does not call an external LLM or upload transcript content.
- Does not modify original session files.
- Compression requires explicit user action and writes a separate output file.
- Current-window commands require Claude hooks. Enable them explicitly with `trimctx init --with-hooks`.
- `trimctx` requires the current-window hook binding and never falls back to latest-file discovery.
- SessionStart writes the current binding through `CLAUDE_ENV_FILE`.
- Stop may update only the trimctx-managed block in the project's `.claude/CLAUDE.md`.
- Hooks keep the original JSONL transcript read-only.

## Requirements

Node.js 20+ is required.

Install the `trimctx` CLI before using these command files.

For installation steps and local development workflow, see the repository `README.md` or `docs/user/usage.md`.
