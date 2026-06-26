# /trimctx — Analyze the current Claude Code conversation context

Run `trimctx analyze --color` to analyze the current Claude Code transcript from `TRIMCTX_TRANSCRIPT_PATH`, then show the result to the user.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, stop and tell the user that current-window analysis requires Claude hooks enabled through interactive `trimctx init`, `trimctx init --with-hooks`, or `trimctx install-hooks`, then restart Claude Code. Do not run `trimctx current` as a fallback because it only selects the latest local JSONL file by modification time.

If the user provides a handoff uid in the form `ctx_...`, treat it as a local trimctx handoff reference instead of running analysis.

For a `ctx_...` uid:
1. Read `.trimctx/handoffs/<uid>/manifest.json`
2. Read `.trimctx/handoffs/<uid>/next-context.md`
3. Read `.trimctx/handoffs/<uid>/handoff.md`
4. Summarize the continuation context from those files

Do not guess another session if the uid package is missing. Report that the referenced handoff package was not found.

After the command finishes, summarize briefly:
1. Conversation health and context pressure
2. Main context-rot or space-usage signals
3. Whether to keep observing, write a report, or explicitly compress

Boundaries:
- Default behavior is analysis only. Do not modify or delete original session files.
- Compression requires an explicit user action through `/trimctx:compress` or `trimctx compress <file> -o <output.jsonl>`.
- If `trimctx` is not found, tell the user to install the CLI and plugin by downloading the installer, reviewing it, then running it: Windows CMD can use `powershell -NoProfile -Command "Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1"`, `type install.ps1`, then `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1`; Windows PowerShell can use `Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1`, `Get-Content install.ps1`, then `powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1`; macOS/Linux/WSL can use `curl -fsSLO https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh`, `less install.sh`, then `bash install.sh`. For local development, run `npm link` after `npm run build`.
