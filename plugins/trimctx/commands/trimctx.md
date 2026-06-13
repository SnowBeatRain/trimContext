# /trimctx — Analyze latest local AI conversation context

Run `trimctx current --source auto --color` to analyze the latest local Claude Code or Codex JSONL session and show the result to the user. This selects by JSONL file modification time, not by a live client API.

After the command finishes, summarize briefly:
1. Conversation health and context pressure
2. Main context-rot or space-usage signals
3. Whether to keep observing, write a report, or explicitly compress

Boundaries:
- Default behavior is analysis only. Do not modify or delete original session files.
- Compression requires an explicit user action through `/trimctx:compress` or `trimctx current --compress <output.jsonl>`.
- If `trimctx` is not found, tell the user to install the CLI and plugin with `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex"` from Windows CMD, `irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex` from Windows PowerShell, or `curl -fsSL https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh | bash` on macOS/Linux/WSL. For local development, run `npm link` after `npm run build`.
