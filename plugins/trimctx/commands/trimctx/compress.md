# /trimctx:compress — Write a safe compressed copy

Run `trimctx current --source auto --compress trimmed.jsonl` to write a compressed copy of the most recent Claude Code or Codex JSONL session.

After the command finishes, tell the user:
1. How many messages were removed
2. How many tokens were saved
3. The original file was not modified and the compressed copy is `trimmed.jsonl`

Never overwrite the original session file. If the user wants a different output path, use `trimctx current --source auto --compress <output.jsonl>`.
