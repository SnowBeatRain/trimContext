# trimctx

**A local-first CLI for auditing and safely trimming long AI conversation context.**

trimctx reads Claude Code, OpenAI, and Codex/Hermes JSONL transcripts, identifies stale or low-value context, produces an auditable health report, and can write a conservative compressed copy. It never modifies the original transcript and does not call an LLM.

Safety comes first: trimctx prefers missing a deletion over deleting the wrong message.

[中文说明](README_zh.md)

## Quick Start

Requires Node.js 20+.

```bash
npm install -g trimctx
trimctx init --target user
trimctx analyze path/to/session.jsonl
trimctx report path/to/session.jsonl -o report.md
```

`report.md` is the recommended human review artifact. Read it before using `compress` or creating a continuation package.

For automation, use the stable JSON paths:

```bash
trimctx report path/to/session.jsonl -o report.json
trimctx analyze path/to/session.jsonl --json
```

Both commands produce the same `trimctx.report.v2` JSON value. `report` also accepts `.md`; any other output extension is rejected.

## Health Semantics

- `healthy` means the available evidence indicates low context risk. It is not permission to delete content.
- `attention` and `degraded` identify reviewable or high-confidence risks.
- `unknown` means evidence is insufficient. It must never be presented as “clean.”
- Protected content is never automatically deleted.
- Every `remove_candidate` must be non-protected and have reasons and decisive evidence.

The short summary uses the report assessment, at most two findings, continuation gaps, and the first recommendation. The full Markdown and JSON reports remain the audit sources.

## Commands

### Analyze

```bash
trimctx analyze path/to/session.jsonl
trimctx analyze path/to/session.jsonl --json
trimctx analyze --select
trimctx analyze --latest
trimctx analyze --latest --source claude
trimctx analyze --latest --source codex
```

With a trusted `TRIMCTX_TRANSCRIPT_PATH` binding, `trimctx analyze` without a file analyzes that bound transcript. Explicit `--select` and `--latest` discovery never restores or switches an AI client window.

### Report

```bash
trimctx report path/to/session.jsonl -o report.md
trimctx report path/to/session.jsonl -o report.json
```

- Markdown is for human review and includes the conclusion, health dimensions, findings, review queue, protected stale signals, continuation status, limitations, and next actions.
- JSON is the complete machine-readable v2 report and matches `analyze --json`.
- Evidence summaries are redacted and capped, including common credential forms such as standard GitHub tokens, but full JSON reports, transcript exports, and continuation packages can contain original transcript content. Review artifacts before sharing.
- Report writes are atomic and reject the input file or an alias of it.

### Export

```bash
trimctx export path/to/session.jsonl -o conversation.md
trimctx export -o conversation.md # trusted current-window binding only
```

`export` writes every message returned by the existing parser in its original parser order. It does not score, filter, truncate, or redact message bodies. The output is a private `trimctx.transcript.v1` Markdown artifact and may contain system instructions, secrets, paths, source code, and complete tool data; review it before sharing.

This is a parser-normalized transcript, not a byte-for-byte JSONL backup. Claude content blocks may be combined and duplicate streaming frames deduplicated. Codex encrypted reasoning and runtime event/turn records ignored by the parser are not included. Output must end in `.md`; writes are atomic, and the source JSONL remains read-only.

### New Chat

```bash
trimctx new-chat path/to/session.jsonl
trimctx new-chat path/to/session.jsonl --out .trimctx/handoffs
```

This writes `.trimctx/handoffs/<uid>/` containing `handoff.md`, `next-context.md`, `manifest.json`, `report.json`, and `README.md`. `manifest.json` records the input hash, artifact paths, health status/confidence, and report schema version. The embedded report is v2.

Review `next-context.md` before pasting it into a new AI window. The UID is a local reference, not a restore token.

With multiple windows open, prefer an explicit JSONL path. After Claude Code hooks are installed, `/trimctx:new-chat` uses the current window's `TRIMCTX_TRANSCRIPT_PATH`. Codex does not yet have a verified current-window binding, so do not use file-less `new-chat` or `--latest` to guess the current Codex window. After generation, verify `input.file`, `session_id`, and `sha256` in `manifest.json`.

### Compress

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

Compression writes a separate JSONL and removes only non-protected `remove_candidate` messages. `keep`, `keep_protected`, and `compress_candidate` remain in the copy. If normalized message IDs are duplicated, compression fails before creating or replacing the output. Review the report first.

### Install Client Assets

```bash
trimctx init --target user
trimctx init --client claude --target user
trimctx init --client codex --target user
trimctx init --target project --dir .
trimctx init --with-hooks --target user
trimctx init --dry-run --target user
```

Hooks are explicit opt-in through `trimctx init --with-hooks`. Installed hook commands use the absolute Node executable and packaged `dist/cli.js` paths resolved at install time; rerun `init --with-hooks --force` after moving or replacing either installation. Stale trimctx-managed hook paths are replaced without removing unrelated hooks.

The repository `install.sh` and `install.ps1` scripts update an existing checkout only when its exact Git origin matches the requested repository. They replace an existing plugin directory only when the trimctx marker or the exact legacy asset fingerprint proves ownership; unknown directories are rejected without deletion.

## Claude Code

The packaged plugin provides:

- `/trimctx` for the hook-bound current transcript
- `/trimctx:analyze` for an explicit JSONL path
- `/trimctx:export` to write the hook-bound current transcript to `conversation.md`
- `/trimctx:new-chat` for the current transcript
- `/trimctx:compress` only after an explicit compression request

`/trimctx` runs:

```bash
trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color
```

If the binding is missing, the command stops instead of guessing another session.

When several Claude Code windows are open, each window's SessionStart hook writes `TRIMCTX_TRANSCRIPT_PATH` and `TRIMCTX_SESSION_ID` through that window's own `CLAUDE_ENV_FILE`. Restart every open window after installing hooks, and do not replace current-window commands with `--latest`. Windows in the same project share `.claude/CLAUDE.md`, so its managed status block may reflect whichever window ran the Stop hook last; this does not change per-window transcript bindings.

Hook write scope is explicit:

- SessionStart writes the current `transcript_path` through `CLAUDE_ENV_FILE` so `TRIMCTX_TRANSCRIPT_PATH` is available.
- Stop may update only the trimctx-managed block in the project's `.claude/CLAUDE.md`.
- The original JSONL transcript remains read-only.

Automatic hooks accept at most 1 MiB of stdin. Stop analysis also accepts at most a 64 MiB transcript and 10,000 normalized messages; over-limit hooks fail before writing a new binding or managed state. These limits apply to the automatic hook path, not explicit CLI commands.

## Codex

The package installs a Codex skill/CLI workflow. For single-window discovery, use `--select` or `--latest --source codex`. With multiple windows, neither mode proves which window is current; pass the confirmed JSONL path explicitly to `analyze`, `report`, `export`, `new-chat`, or `compress`. This project does not claim a verified Codex `/trimctx` slash command or verified current-window transcript binding.

## Supported Inputs

| Format | Status |
| --- | --- |
| Claude Code JSONL | Supported |
| OpenAI JSONL | Supported |
| Codex/Hermes rollout JSONL | Supported |
| Plain text, databases, remote APIs | Not supported |

## Safety Verification

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

The two input hashes must match. Real transcripts and generated private reports must not be committed or included in npm packages.

The current workflow is validated for local use, but this is not a claim that Phase 0 trust is locked. Any claim of compression safety without human review still requires the formal release gates in `docs/dev/phase0/phase0-plan.md`.

## Development

```bash
npm install
npm test
npm run build
```

See [docs/user/usage.md](docs/user/usage.md), [docs/dev/requirements.md](docs/dev/requirements.md), and [docs/dev/roadmap.md](docs/dev/roadmap.md).

## License

MIT
