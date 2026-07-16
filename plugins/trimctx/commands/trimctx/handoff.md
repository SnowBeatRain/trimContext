# /trimctx:handoff — Create a current-session new-chat package

Run `trimctx handoff "$TRIMCTX_TRANSCRIPT_PATH"` as a compatibility alias for `trimctx new-chat "$TRIMCTX_TRANSCRIPT_PATH"` to create a UID-based new-chat package for the current Claude Code transcript.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window handoff requires Claude hooks enabled through interactive `trimctx init`, `trimctx init --with-hooks`, or `trimctx install-hooks`, then restart Claude Code. Do not replace this flow with `trimctx current`; it is an analysis-only command that requires the same current-window binding.

After the command finishes, tell the user:
1. The copyable UID printed by trimctx
2. The new-chat package path
3. That the package may include original transcript content and secrets, so it must be reviewed before sharing

Do not modify or delete the original session file.
