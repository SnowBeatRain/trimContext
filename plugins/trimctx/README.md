# trimctx Claude Code plugin

Analyze the latest local Claude Code or Codex JSONL conversation from inside Claude Code.

## Commands

- `/trimctx` — analyze the latest local session.
- `/trimctx:analyze` — run the same analysis explicitly.
- `/trimctx:resume` — generate a compact resume-oriented summary.
- `/trimctx:compress` — only when the user explicitly asks to write a compressed copy.

## Safety

- Reads local JSONL exports only.
- Does not call an external LLM or upload transcript content.
- Does not modify original session files.
- Compression requires explicit user action and writes a separate output file.

## Requirements

Node.js 20+ is required.

Install the CLI and Claude Code plugin from GitHub without publishing to npm.

Windows CMD:

```bat
powershell -NoProfile -Command "Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1"
type install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

Windows PowerShell:

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1
Get-Content install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux / WSL:

```bash
curl -fsSLO https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh
less install.sh
bash install.sh
```

Then restart Claude Code and run:

```text
/trimctx
```

For local development from this repository, run:

```bash
npm install
npm run build
npm link
mkdir -p ~/.claude/plugins
rm -rf ~/.claude/plugins/trimctx
cp -R plugins/trimctx ~/.claude/plugins/trimctx
```

The commands do not modify original session files by default. Compression is only triggered by `/trimctx:compress` or an explicit `trimctx current --compress <output.jsonl>` command.

## Safety boundary
