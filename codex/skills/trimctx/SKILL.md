---
name: trimctx
description: Use the local trimctx CLI to analyze and safely compress Claude Code, OpenAI, Codex, or Hermes JSONL conversation context. Use when the user asks to inspect context rot, summarize long-session health, analyze latest local sessions, or produce safe compressed copies without modifying originals.
metadata:
  short-description: Analyze and safely trim AI JSONL context
---

# trimctx

Use the `trimctx` CLI as the source of truth. Do not reimplement JSONL parsing, scoring, reporting, or compression inside Codex instructions.

## Requirements

`trimctx` must be available on `PATH`. Install the CLI and Claude Code plugin from GitHub without requiring an npm release:

Windows CMD:

```bat
pwsh -NoProfile -Command "Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1"
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

If trimctx is published to npm later, global npm install can also be used:

```bash
npm install -g trimctx
```

For local development from the repository:

```bash
npm install
npm run build
npm link
```

## Common Commands

`trimctx analyze --json` without a file only analyzes a trusted current-window binding such as `TRIMCTX_TRANSCRIPT_PATH`; it never guesses from file modification time. Codex current-window binding is not documented as verified support, so use an explicit file, `--select`, or `--latest` unless an integration provides that binding.

- Analyze the latest Claude Code or Codex session:
  ```bash
  trimctx analyze --latest --source auto --color
  ```
- Analyze the latest Claude Code session only:
  ```bash
  trimctx analyze --latest --source claude --color
  ```
- Analyze the latest Codex session only:
  ```bash
  trimctx analyze --latest --source codex --color
  ```
- Choose a local Claude Code or Codex session interactively:
  ```bash
  trimctx analyze --select --color
  ```
- Analyze a specific JSONL file:
  ```bash
  trimctx analyze <file.jsonl> --color
  ```
- Write a human-readable Markdown report:
  ```bash
  trimctx report <file.jsonl> -o report.md
  ```
- Write a machine-readable JSON report:
  ```bash
  trimctx report <file.jsonl> -o report.json
  ```
- Write a safe compressed copy:
  ```bash
  trimctx compress <file.jsonl> -o trimmed.jsonl
  ```
- Generate new-chat continuation artifacts for continuing work in a later session:
  ```bash
  trimctx new-chat <file.jsonl>
  ```
  This writes `.trimctx/handoffs/<uid>/` with `handoff.md`, `next-context.md`, `manifest.json`, and `report.json` by default.

- Generate new-chat continuation artifacts from a trusted current transcript binding:
  ```bash
  trimctx new-chat
  ```
  Only use this form when `TRIMCTX_TRANSCRIPT_PATH` is already set by the current AI client session. Do not synthesize that variable from latest-file discovery.

## Multiple Codex Windows

Codex current-window transcript binding is not verified. When multiple Codex windows are open:

- `--latest --source codex` means the newest local Codex session file, not necessarily the current window.
- `--select --source codex` is a manual choice, not proof of the current window.
- Never run file-less `trimctx new-chat` unless an integration has explicitly supplied a trusted `TRIMCTX_TRANSCRIPT_PATH` for this window.
- Pass the confirmed JSONL path explicitly to `analyze`, `report`, `new-chat`, and `compress` whenever exact window identity matters.
- After `new-chat`, verify `input.file`, `session_id`, and `sha256` in `.trimctx/handoffs/<uid>/manifest.json` before continuing from the package.

## New-chat UID Handling

If the user provides a new-chat uid in the form `ctx_...`, treat it as a local new-chat package reference.

Read files in this order:

1. `.trimctx/handoffs/<uid>/manifest.json`
2. `.trimctx/handoffs/<uid>/next-context.md`
3. `.trimctx/handoffs/<uid>/handoff.md`

Use `manifest.json` as the source of truth for package metadata and paths. Do not guess another session when the requested uid is missing; tell the user the referenced new-chat package was not found.

## Safety Rules

- Default to analysis only. A `healthy` status is not deletion permission, and `unknown` means evidence is insufficient.
- Never overwrite the input JSONL file.
- Protected content is never automatically deleted.
- Only run compression when the user explicitly asks for it.
- Treat `compress` output as a new artifact; do not write it back into an active AI client session automatically.
- If no trusted current transcript binding or explicit file path is available, ask the user for an explicit JSONL path instead of guessing.

## Codex Boundary

This skill provides a Codex-supported entry point for using `trimctx`. It is not the same as a verified Codex slash command named `/trimctx`; keep documentation honest unless Codex adds or verifies such a mechanism. Do not claim Codex can provide a current-window `transcript_path` unless an official or local integration has explicitly provided it.
