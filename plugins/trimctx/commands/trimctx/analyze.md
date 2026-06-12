# /trimctx:analyze — Analyze a specific session file

The user must provide a JSONL file path as $ARGUMENTS. Treat `$ARGUMENTS` as one file path only; do not append shell fragments or extra arguments.

Run `trimctx analyze "$ARGUMENTS" --color` to analyze the specified Claude Code, OpenAI, Codex, or Hermes JSONL conversation.

After the command finishes, summarize briefly:
1. Conversation health and context pressure
2. Main issues
3. Recommended next step

Do not modify or delete any original session file.
