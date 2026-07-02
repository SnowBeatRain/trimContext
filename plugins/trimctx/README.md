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
- Current-window commands require Claude hooks. Enable them during interactive `trimctx init`, or install/repair them later with `trimctx init --with-hooks` or `trimctx install-hooks`.
- `trimctx current` remains a latest-file discovery command and is not used as a current-window fallback.

## Requirements

Node.js 20+ is required.

Install the `trimctx` CLI before using these command files.

For installation steps and local development workflow, see the repository `README.md` or `docs/user/usage.md`.
