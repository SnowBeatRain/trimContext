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

`trimctx current` is latest-file discovery, not a verified current Codex window API. For current-window safety, use an explicit JSONL file path unless the AI client provides a trusted transcript binding such as `TRIMCTX_TRANSCRIPT_PATH`.

- Analyze the latest Claude Code or Codex session:
  ```bash
  trimctx current --source auto --color
  ```
- Analyze the latest Claude Code session only:
  ```bash
  trimctx current --source claude --color
  ```
- Analyze the latest Codex session only:
  ```bash
  trimctx current --source codex --color
  ```
- Analyze a specific JSONL file:
  ```bash
  trimctx analyze <file.jsonl> --color
  ```
- Write a JSON report:
  ```bash
  trimctx report <file.jsonl> -o report.json
  ```
- Write a safe compressed copy:
  ```bash
  trimctx compress <file.jsonl> -o trimmed.jsonl
  ```
- Generate handoff artifacts for continuing work in a later session:
  ```bash
  trimctx handoff <file.jsonl>
  ```
  This writes `.trimctx/handoffs/<uid>/` with `handoff.md`, `next-context.md`, `manifest.json`, and `report.json` by default.

- Generate handoff artifacts from a trusted current transcript binding:
  ```bash
  trimctx handoff
  ```
  Only use this form when `TRIMCTX_TRANSCRIPT_PATH` is already set by the current AI client session. Do not synthesize that variable from latest-file discovery.

## Handoff UID Handling

If the user provides a handoff uid in the form `ctx_...`, treat it as a local handoff package reference.

Read files in this order:

1. `.trimctx/handoffs/<uid>/manifest.json`
2. `.trimctx/handoffs/<uid>/next-context.md`
3. `.trimctx/handoffs/<uid>/handoff.md`

Use `manifest.json` as the source of truth for package metadata and paths. Do not guess another session or fall back to `trimctx current` when the requested uid is missing; tell the user the referenced handoff package was not found.

## Safety Rules

- Default to analysis only.
- Never overwrite the input JSONL file.
- Only run compression when the user explicitly asks for it.
- Treat `compress` output as a new artifact; do not write it back into an active AI client session automatically.
- If no trusted current transcript binding or explicit file path is available, ask the user for an explicit JSONL path instead of guessing.

## Codex Boundary

This skill provides a Codex-supported entry point for using `trimctx`. It is not the same as a verified Codex slash command named `/trimctx`; keep documentation honest unless Codex adds or verifies such a mechanism. Do not claim Codex can provide a current-window `transcript_path` unless an official or local integration has explicitly provided it.
