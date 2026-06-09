# trimctx

A local-first TypeScript CLI for inspecting long AI conversation JSONL files and producing conservative, auditable trimming recommendations.

trimctx currently supports Claude Code and OpenAI-style JSONL conversations. It analyzes each message, marks protected content, explains why a message should be kept or considered for removal, writes JSON reports, and can generate a compressed copy that leaves the original file untouched.

**Safety rule: trimctx prefers missing a deletion over deleting the wrong message.** `compress` never edits the input JSONL file in place.

[中文说明](README_zh.md)

## Current Status

trimctx is an early CLI tool. The implemented commands are:

- `trimctx analyze <file>` — print a short analysis summary, or full JSON with `--json`
- `trimctx report <file> -o <report.json>` — write a complete JSON report
- `trimctx compress <file> -o <output.jsonl>` — write a safe compressed copy
- `trimctx resume` — analyze the newest Claude Code session under `~/.claude/projects/`

## Quick Start

### Run from source

Requires Node.js 20+.

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

Analyze a conversation file:

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

Write a full report:

```bash
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
```

Generate a compressed copy:

```bash
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

After building, you can run the compiled CLI directly:

```bash
node dist/cli.js analyze path/to/session.jsonl
```

### Global npm install

The package is prepared for npm-style global installation, but use this only after a version has been published to npm:

```bash
npm install -g trimctx
trimctx analyze path/to/session.jsonl
```

## What trimctx Does

- Detects Claude Code JSONL and OpenAI JSONL input formats.
- Normalizes messages, tool-use blocks, tool results, and metadata events for analysis.
- Estimates token counts locally without calling an LLM or remote API.
- Protects high-risk content such as recent messages, system/developer instructions, user decisions, code, errors, file paths, commands, diffs, schema/API/config changes, and referenced tool results.
- Scores lower-value or stale content using dimensions such as age, redundancy, low reference, orphaned tool output, superseded instructions, and metadata noise.
- Produces human-readable summaries and full JSON reports with decisions and reasons.
- Writes compressed JSONL copies by excluding only non-protected `remove_candidate` messages.

## Commands

### `trimctx analyze <file>`

Analyze a Claude Code or OpenAI JSONL conversation.

```bash
trimctx analyze session.jsonl
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

Options:

| Flag | Default | Description |
|---|---:|---|
| `--json` | `false` | Print the full JSON report instead of the short summary |
| `--color` | `false` | Colorize the terminal summary |
| `--recent-window <count>` | `30` | Hard-protect the most recent N messages |
| `--remove-threshold <score>` | `0.80` | Minimum `rot_score` for `remove_candidate` |
| `--compress-threshold <score>` | `0.60` | Minimum `rot_score` for `compress_candidate` |

### `trimctx report <file> -o <report.json>`

Write a complete JSON report to a file.

```bash
trimctx report session.jsonl -o report.json
```

The report includes input metadata, summary counts, per-message decisions, token estimates, scores, reasons, remove candidates, and warnings.

### `trimctx compress <file> -o <output.jsonl>`

Write a new JSONL file that excludes only non-protected `remove_candidate` messages.

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

Decision behavior:

| Decision | Output behavior |
|---|---|
| `keep_protected` | Kept |
| `keep` | Kept |
| `compress_candidate` | Kept; currently report-only |
| `remove_candidate` | Removed only when not protected |

### `trimctx resume`

Find the most recently modified `.jsonl` session under `~/.claude/projects/` and analyze it.

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

`resume` is intended for Claude Code local session folders. It does not discover OpenAI files outside `~/.claude/projects/`.

## Supported Inputs

| Input | Status |
|---|---|
| Claude Code JSONL | Supported |
| OpenAI Chat Completion-style JSONL | Supported |
| Plain text transcripts | Not supported |
| Databases or remote APIs | Not supported |

## Safety Model

trimctx protects content that is likely to remain important:

- `system` and `developer` messages
- the most recent messages in the configured recent window
- memory-like instructions such as "remember", "from now on", or "don't forget"
- explicit user decisions and corrections
- code blocks, stack traces, file paths, shell commands, and git diffs
- test failures and debugging evidence
- architecture, API, schema, and configuration changes
- tool results referenced later by natural-language summaries

To verify that `compress` did not modify the original file, compare a hash before and after running it:

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

The two hashes for `session.jsonl` should match.

## Limitations

- `compress_candidate` is currently a report-only decision; trimctx does not rewrite or summarize messages.
- Token counts are local estimates, not exact model-specific tokenizer counts.
- Phase 0 still needs more real long-session validation before aggressive defaults should be trusted.
- trimctx does not provide a Web UI, MCP server, database, installer, or Claude Code slash command yet.

## Documentation

- [Usage Guide](docs/usage.md) — detailed command examples, outputs, and safety checks
- [Roadmap](docs/roadmap.md) — planned milestones and release criteria
- [Requirements](docs/requirements.md) — project scope, constraints, and acceptance criteria
- [Current Status](docs/status-and-next-steps.md) — implementation status and next steps

## Development

```bash
npm install
npm test
npm run build
```

## License

[MIT](LICENSE)
