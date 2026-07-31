# /trimctx:export - Export the current conversation transcript

Run `trimctx export "$TRIMCTX_TRANSCRIPT_PATH" -o conversation.md` to write the current Claude Code conversation as parser-normalized Markdown.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window transcript export requires hooks enabled with `trimctx init --with-hooks`, then restart Claude Code. Do not guess or fall back to the latest session.

After the command finishes, tell the user:

1. The output path is `conversation.md`
2. The original JSONL transcript was not modified
3. The output is unredacted and may contain system instructions, secrets, paths, source code, and full tool results, so it must be reviewed before sharing

The Markdown is a parser-normalized transcript, not a byte-for-byte backup of the source JSONL. Never modify or overwrite the original transcript.
