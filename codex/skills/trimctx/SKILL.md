---
name: trimctx
description: Use the local trimctx CLI to analyze and safely compress Claude Code, OpenAI, Codex, or Hermes JSONL conversation context. Use when the user asks to inspect context rot, summarize long-session health, run trimctx on the current session, or produce safe compressed copies without modifying originals.
metadata:
  short-description: Analyze and safely trim AI JSONL context
---

# trimctx

Use the `trimctx` CLI as the source of truth. Do not reimplement JSONL parsing, scoring, reporting, or compression inside Codex instructions.

## Requirements

`trimctx` must be available on `PATH`:

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

## Safety Rules

- Default to analysis only.
- Never overwrite the input JSONL file.
- Only run compression when the user explicitly asks for it.
- Treat `compress` output as a new artifact; do not write it back into an active AI client session automatically.
- If no session is found, ask the user for an explicit JSONL path instead of guessing.

## Codex Boundary

This skill provides a Codex-supported entry point for using `trimctx`. It is not the same as a verified Codex slash command named `/trimctx`; keep documentation honest unless Codex adds or verifies such a mechanism.
