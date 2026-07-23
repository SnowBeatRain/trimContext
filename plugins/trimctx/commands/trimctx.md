# /trimctx - Analyze the current Claude Code conversation context

Run `trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color`, then show the result to the user.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window analysis requires hooks enabled with `trimctx init --with-hooks`, then restart Claude Code. Do not guess or select a different transcript.

After the command finishes, summarize briefly:

1. Health status and confidence
2. Up to two key findings and any evidence limitations
3. The first recommended next action

Boundaries:

- Analysis is read-only. Never modify or delete the original JSONL transcript.
- `healthy` is not permission to delete content; `unknown` means evidence is insufficient.
- Protected content is never eligible for automatic deletion.
- Use `/trimctx:new-chat` when the user explicitly asks to create continuation artifacts.
- Compression requires `/trimctx:compress` or an explicit `trimctx compress <file> -o <output.jsonl>` command.
