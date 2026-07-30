# /trimctx:compress — Write a safe compressed copy

Run `trimctx compress "$TRIMCTX_TRANSCRIPT_PATH" -o trimmed.jsonl` to write a compressed copy of the current Claude Code transcript.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window compression requires hooks enabled with `trimctx init --with-hooks`, then restart Claude Code. Do not replace this flow with `trimctx`; it is an analysis-only command that requires the same current-window binding.

After the command finishes, tell the user:
1. How many messages were removed
2. How many tokens were saved
3. The original file was not modified and the compressed copy is `trimmed.jsonl`

Never overwrite the original session file. If the user wants a different output path, use `trimctx compress "$TRIMCTX_TRANSCRIPT_PATH" -o <output.jsonl>`.
