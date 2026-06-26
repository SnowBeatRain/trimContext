# /trimctx:compress — Write a safe compressed copy

Run `trimctx compress "$TRIMCTX_TRANSCRIPT_PATH" -o trimmed.jsonl` to write a compressed copy of the current Claude Code transcript.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window compression requires Claude hooks enabled through interactive `trimctx init`, `trimctx init --with-hooks`, or `trimctx install-hooks`, then restart Claude Code. Do not run `trimctx current` as a fallback because it may select another session.

After the command finishes, tell the user:
1. How many messages were removed
2. How many tokens were saved
3. The original file was not modified and the compressed copy is `trimmed.jsonl`

Never overwrite the original session file. If the user wants a different output path, use `trimctx compress "$TRIMCTX_TRANSCRIPT_PATH" -o <output.jsonl>`.
