# trimctx Usage Guide

trimctx is a local, deterministic CLI for analyzing Claude Code, OpenAI, and Codex/Hermes JSONL transcripts. It does not call an LLM, upload transcript data, or modify the original JSONL.

## Install

Requires Node.js 20+.

```bash
npm install -g trimctx
trimctx --version
trimctx init --target user
```

Install Claude hooks only when current-window binding is needed:

```bash
trimctx init --target user --with-hooks
```

## Recommended Workflow

1. Analyze the session.
2. Write and review a Markdown report.
3. Use JSON only for automation or deeper audit.
4. Export the complete normalized transcript only when you need the full conversation.
5. Create a new-chat package or compressed copy only after review.

```bash
trimctx analyze path/to/session.jsonl
trimctx report path/to/session.jsonl -o report.md
trimctx report path/to/session.jsonl -o report.json
trimctx export path/to/session.jsonl -o conversation.md
trimctx new-chat path/to/session.jsonl
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

`healthy` is not deletion permission. `unknown` means evidence is insufficient, not that the conversation is clean. Protected messages are never automatically deleted.

## Analyze

```bash
trimctx analyze <file>
trimctx analyze <file> --json
trimctx analyze --select
trimctx analyze --latest
trimctx analyze --latest --source claude
trimctx analyze --latest --source codex
```

The terminal summary reads the v2 assessment, displays at most two findings, lists missing continuation evidence, and shows only the first recommendation. It intentionally omits internal score and token breakdowns.

Without a file, `analyze` accepts only a trusted `TRIMCTX_TRANSCRIPT_PATH` binding. `--select` and `--latest` are explicit discovery modes. Selecting a JSONL file does not restore or switch an AI client window.

Use `--json` for the complete `trimctx.report.v2` value.

## Report

The output file must end in `.md` or `.json` (case-insensitive).

```bash
# Human review
trimctx report session.jsonl -o report.md

# Automation
trimctx report session.jsonl -o report.json
trimctx analyze session.jsonl --json
```

`report.json` and `analyze --json` are deeply equivalent. JSON is pretty-printed with a trailing newline.

The Markdown report contains:

- conclusion and confidence
- health dimensions
- key findings with finding, evidence, impact, and action
- review queue
- protected but possibly stale items
- trusted continuation status
- limitations and safety notes
- next actions

Displayed evidence contains only message id, source line, role, and a redacted summary capped at 160 characters. Long Markdown review sections show the first 20 items per queue plus an omitted-count note; the complete `review_queue` remains in JSON. Token-like secrets, email addresses, key/value secrets, and Basic Auth credentials are redacted. Markdown table pipes and line breaks are escaped. This narrow display does not mean every generated artifact is safe to share; review it first.

Report writes use a same-directory temporary file and atomic replacement. The command rejects the input file and aliases of it, keeps an existing report intact when rendering or writing fails, and rechecks the open input handle before replacement.

## Export

```bash
trimctx export session.jsonl -o conversation.md
trimctx export -o conversation.md # trusted current-window binding only
```

The command writes every `NormalizedMessage` returned by the existing parser in parser order. It does not run tokenization, safety rules, scoring, threshold decisions, report redaction, filtering, or truncation. Message roles, IDs, source lines, and available timestamp, parent, session, and tool metadata remain auditable in the `trimctx.transcript.v1` document.

The Markdown is unredacted and may contain system instructions, credentials, local paths, source code, and complete tool inputs or results. Treat it as a private local artifact and review it before sharing. It is parser-normalized rather than a byte-for-byte JSONL backup: Claude content blocks may be combined and duplicate streaming frames deduplicated; Codex encrypted reasoning and parser-ignored runtime event/turn records are excluded.

Output must end in `.md` (case-insensitive). The command rejects the input file and its aliases, uses atomic replacement, does not print message bodies to stdout, and keeps the original JSONL read-only. Without `[file]`, it accepts only a valid `TRIMCTX_TRANSCRIPT_PATH` current-window binding and never falls back to latest-session discovery.

## New Chat

```bash
trimctx new-chat session.jsonl
trimctx new-chat session.jsonl --out custom-root
```

The command writes `.trimctx/handoffs/<uid>/` by default:

- `handoff.md`
- `next-context.md`
- `manifest.json`
- `report.json`
- `README.md`

`manifest.json` preserves the source hash and file lists and records `health_status`, `health_confidence`, and `report_schema_version`. The embedded `report.json` is v2. Candidate and protected sections preserve the report review-queue order; continuation sections use trusted resume evidence.

Review the package before sharing or pasting it into a new window. It may contain original transcript content and secrets. The UID is a local package reference, not a restore token.

## Multiple Windows and Current Sessions

An explicit `<file>` is always the command's source of truth. In a multi-window environment, do not treat the most recently modified session as proof of the current window.

After Claude Code hooks are installed, SessionStart writes that window's `transcript_path` and optional `session_id` through its own `CLAUDE_ENV_FILE`, creating `TRIMCTX_TRANSCRIPT_PATH` and `TRIMCTX_SESSION_ID` bindings. If a hook input omits `session_id`, SessionStart writes an empty ID binding so an older ID cannot remain paired with the new transcript. Restart every already-open Claude Code window after installation. `/trimctx`, `/trimctx:export`, `/trimctx:new-chat`, and `/trimctx:compress` use the bound path and stop when it is missing instead of falling back to another session. File-less `trimctx analyze` and `trimctx export -o conversation.md` also check that the bound path is a readable file and, when a session ID exists, that it matches the transcript filename.

Claude Code windows in the same project share `.claude/CLAUDE.md`. The managed status block may be updated by whichever window runs the Stop hook last, but that does not change each window's transcript binding.

Codex does not currently have a verified automatic window binding:

- `--latest --source codex` selects the most recently modified file across local Codex sessions; it does not guarantee the current window.
- `--select --source codex` is a manual choice, not an automatic binding.
- File-less `trimctx new-chat` may fall back to the latest session when no binding exists; do not use this form with multiple Codex windows.
- To strictly target a Codex window, pass its confirmed JSONL path explicitly to every command.

```powershell
trimctx analyze --select --source codex
trimctx analyze "C:\Users\name\.codex\sessions\...\rollout.jsonl"
trimctx export "C:\Users\name\.codex\sessions\...\rollout.jsonl" -o conversation.md
trimctx new-chat "C:\Users\name\.codex\sessions\...\rollout.jsonl"
```

After generating a package, inspect `input.file`, `session_id`, and `sha256` in `.trimctx/handoffs/<uid>/manifest.json` before using it in a new window. Resolve the UID from the same project directory or from the explicit `--out` directory.

## Compress

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

Compression writes a new file and never changes the input. It removes only non-protected `remove_candidate` messages. Protected messages, `keep`, and `compress_candidate` remain in the copy. A candidate is still a review item; a health status does not authorize deletion.

The output uses same-directory atomic replacement. A recoverable write or commit failure keeps an existing compressed copy intact, and a change to the open input after its pre-read snapshot aborts the replacement instead of committing output derived from stale bytes.

## Claude Code Plugin

Install assets and opt into hooks:

```bash
trimctx init --client claude --target user --with-hooks
```

After restarting Claude Code:

- `/trimctx` runs `trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color`.
- `/trimctx:analyze` accepts an explicit JSONL file.
- `/trimctx:export` writes the unredacted current-session transcript to `conversation.md`.
- `/trimctx:new-chat` creates the current-session continuation package.
- `/trimctx:compress` writes a separate copy only after an explicit request.

If `TRIMCTX_TRANSCRIPT_PATH` is missing, current-window commands stop instead of guessing another session.

Hook write scope:

- SessionStart writes `transcript_path` and session binding data through `CLAUDE_ENV_FILE`; trimctx rejects that target when it is the transcript or an existing filesystem alias of it.
- Stop analyzes a read-only snapshot. If the transcript has not yet recorded the final reply, it supplements that reply in memory from Claude's `last_assistant_message`; an equivalent newest assistant message is not added twice.
- Stop may update only the trimctx-managed block in the project's `.claude/CLAUDE.md`.
- Original JSONL transcripts remain read-only.

## Codex Skill

Install the packaged skill:

```bash
trimctx init --client codex --target user
```

Use an explicit file, `trimctx analyze --select --source codex`, or `trimctx analyze --latest --source codex`. To export the complete conversation, run `trimctx export <file.jsonl> -o conversation.md` with a confirmed path. With multiple windows, pass that path explicitly; neither `--latest` nor `--select` is an automatic current-window binding. The package documents a skill/CLI workflow, not a verified Codex `/trimctx` slash command or verified current-window binding.

## Report v2

Top-level fields include:

- `schema_version`
- `input`, `summary`, and `tokenization`
- `parser_diagnostics` and `phase0_trust`
- `resume`, `assessment`, and `findings`
- `review_queue` and `candidate_groups`
- `recommendations` and `analysis_meta`
- `messages`, candidate arrays, and `warnings`

The JSON report is complete audit data and can contain full message content. Keep private reports out of git and npm packages.

## Supported Inputs

| Format | Status |
| --- | --- |
| Claude Code JSONL | Supported |
| OpenAI JSONL | Supported |
| Codex/Hermes rollout JSONL | Supported |
| Plain text | Not supported |

## Troubleshooting

### No bound transcript

Pass an explicit file, use `--select`/`--latest`, or install Claude hooks with `trimctx init --with-hooks` and restart Claude Code.

### Report output rejected

Use `.md` or `.json`, and choose a path different from the input transcript.

### Export output rejected

Use `.md`, choose a path different from the input transcript, and pass an explicit input file when no trusted current-window binding exists.

### Zero remove candidates

This can be a conservative safety result. Review findings and limitations; do not lower internal thresholds from public CLI examples.

### Verify the input is unchanged

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

The hashes must match.
