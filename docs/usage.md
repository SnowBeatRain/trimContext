# Usage Guide

This guide explains how to run trimctx safely against local Claude Code, OpenAI, or Codex/Hermes rollout JSONL conversation files.

[中文版](usage_zh.md)

## Requirements

- Node.js 20 or later
- A JSONL conversation file from Claude Code, an OpenAI-style chat export, or a Codex/Hermes rollout export

trimctx is local-only: it does not call an LLM, upload files, or use a database.

## Installation

### From source

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
```

Run the source CLI during development:

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

Run the compiled CLI after `npm run build`:

```bash
node dist/cli.js analyze path/to/session.jsonl
```

### Global npm install

Install the published CLI globally for regular use:

```bash
npm install -g trimctx
trimctx analyze path/to/session.jsonl
```

## Quick Start

Analyze a file and print a short summary:

```bash
trimctx analyze path/to/session.jsonl
```

Typical summary shape:

```text
trimctx analysis

messages: 633
tokens: 218,385
protected: 338
remove candidates: 41
compress candidates: 30
estimated saving: 5,592 tokens (2.56%)

trust:
- 0 remove candidates means nothing crossed the safe deletion threshold.
- compress candidates, if any, are report-only and kept by default.
- max score: 0.6428; near threshold: 0

top reasons:
- recent_message: 241
- superseded_by_later_instruction: 195
- old_message: 190

next:
- trimctx report <file> -o report.json
- trimctx compress <file> -o output.jsonl
```

Write a full JSON report before compressing:

```bash
trimctx report path/to/session.jsonl -o report.json
```

Generate a compressed copy only after reviewing the report:

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

Generate handoff artifacts for continuing work in a later session:

```bash
trimctx handoff path/to/session.jsonl -o handoff.md --next-context next-context.md
```

## Recommended Workflow

1. Run `analyze` to see whether trimctx finds meaningful candidates.
2. Run `report` and inspect the reasons for `remove_candidate` messages.
3. Keep the original JSONL file unchanged.
4. Run `compress` with `-o` to create a new file.
5. Compare the original file hash before and after compression if you need safety evidence.

```bash
sha256sum session.jsonl
trimctx report session.jsonl -o report.json
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

The two hashes for `session.jsonl` should match.

## Phase 0 validation for shared use

If you plan to recommend trimctx to other users or validate a release candidate, run the private multi-sample validation workflow:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

The workflow is documented in `docs/phase0/phase0-plan.md`, `docs/phase0/manual-label-guide.md`, and `docs/phase0/validation-summary-template.md`.

`reports/phase0/phase0-results.json` is private by default. It can include local paths plus captured `stderr` or `error` details, so publish only a sanitized summary or manually redacted excerpt.

## Commands

### `trimctx analyze <file>`

Analyze a Claude Code, OpenAI, or Codex/Hermes rollout JSONL conversation and print a terminal summary.

```bash
trimctx analyze session.jsonl
```

Options:

| Flag | Description |
|---|---|
| `--json` | Print the full JSON report instead of the short summary |
| `--color` | Colorize the terminal summary |
| `--recent-window <count>` | Hard-protect the most recent N messages; default `30` |
| `--remove-threshold <score>` | `rot_score` threshold for `remove_candidate`; default `0.80` |
| `--compress-threshold <score>` | `rot_score` threshold for `compress_candidate`; default `0.60` |

Examples:

```bash
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

### `trimctx report <file> -o <report.json>`

Write a complete JSON report.

```bash
trimctx report session.jsonl -o report.json
```

The report includes:

- `input` — source file metadata
- `summary` — message counts, token estimates, protected count, candidate counts, estimated savings, and score diagnostics
- `messages` — per-message token estimates, decisions, reasons, and scores
- `remove_candidates` — messages selected for safe removal by current thresholds
- `warnings` — parser or analysis issues encountered during processing

`summary.score_diagnostics` is for threshold tuning and validation. It includes `max_rot_score`, `p90_rot_score`, `near_remove_threshold_count`, `protected_high_rot_count`, and `decision_score_ranges`. These diagnostics do not change message decisions or compression behavior.

### `trimctx compress <file> -o <output.jsonl>`

Create a new JSONL file. The `-o` flag is required.

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

`compress` removes only non-protected `remove_candidate` messages. It keeps `compress_candidate` messages because they are currently report-only.

If a report contains `compress_candidate` messages but no `remove_candidate` messages, the parser and scorer can still be working correctly. It means the messages crossed the reporting threshold but did not cross the stricter removal threshold. This is expected for safety-sensitive or sparsely validated formats such as Codex/Hermes rollout files.

| Decision | Behavior |
|---|---|
| `keep_protected` | Kept |
| `keep` | Kept |
| `compress_candidate` | Kept; report-only candidate |
| `remove_candidate` | Removed only if not protected |

### `trimctx handoff <file> -o <handoff.md>`

Write deterministic Markdown artifacts for continuing a long or noisy session without mutating the original JSONL.

```bash
trimctx handoff session.jsonl -o handoff.md --next-context next-context.md
```

The primary handoff includes source metadata, safety diagnostics, continuation rules, candidate review queue, warnings, and next commands. The optional `--next-context` file writes a shorter context packet for another agent or session.

### `trimctx current`

Analyze the most recently modified Claude Code or Codex `.jsonl` session under local client session directories.

```bash
trimctx current
trimctx current --source auto
trimctx current --source claude
trimctx current --source codex
trimctx current --json
trimctx current --compress session.trimmed.jsonl
```

`--source auto` scans the Claude Code project session root and the Codex session root, then chooses the newest JSONL file. `--source claude` scans only `~/.claude/projects/`; `--source codex` scans only `~/.codex/sessions/`.

### `trimctx resume`

Analyze the most recently modified Claude Code `.jsonl` session under `~/.claude/projects/`.

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

`resume` uses Claude Code's local session directory. If no session exists there, it exits with an error. It does not scan arbitrary directories.

## Client Integrations

### Claude Code

This repository includes project-level command files under `.claude/commands/`:

- `.claude/commands/trimctx.md` exposes `/trimctx` for analyzing the latest Claude Code or Codex session.
- `.claude/commands/trimctx/analyze.md` exposes `/trimctx:analyze <file>`.
- `.claude/commands/trimctx/resume.md` exposes `/trimctx:resume`.
- `.claude/commands/trimctx/compress.md` exposes `/trimctx:compress`.

The npm package also includes `plugins/trimctx/`, a Claude Code plugin wrapper with the same command files. These commands call the `trimctx` executable, so install the CLI globally or run `npm link` during local development.

Safety boundary: these commands analyze exported/local JSONL files. They do not install hooks, do not write back into Claude Code sessions, and do not compress unless the user chooses `/trimctx:compress` or a CLI command with `--compress`.

### Codex

The package includes `codex/skills/trimctx/SKILL.md`, which provides a Codex-supported skill entry point for the CLI workflow. This is not documented as a verified Codex `/trimctx` slash command; use the skill or run `trimctx current --source codex` directly. Codex discovery currently scans `~/.codex/sessions/` only.

## Supported Input Formats

| Format | Status |
|---|---|
| Claude Code JSONL | Supported |
| OpenAI Chat Completion-style JSONL | Supported |
| Codex/Hermes rollout JSONL | Supported |
| Plain text transcripts | Not supported |
| Remote APIs or databases | Not supported |

## Report Decisions

| Decision | Meaning |
|---|---|
| `keep_protected` | High-risk or recent content protected by safety rules |
| `keep` | Content does not meet candidate thresholds |
| `compress_candidate` | Possibly low-value content, but not removed by current compressor |
| `remove_candidate` | Non-protected content that meets the removal threshold |

## Scoring Dimensions

Each message can receive scores across these dimensions:

| Dimension | Description |
|---|---|
| `superseded_score` | Later messages override or correct earlier instructions |
| `low_reference_score` | The message is not referenced by later context |
| `age_score` | Older messages receive more decay |
| `redundancy_score` | The message is similar to nearby content |
| `orphan_tool_score` | Tool calls or results are not connected to later context |
| `low_value_score` | Metadata, acknowledgments, or low-information content |

The combined `rot_score` maps to decisions after protection rules are applied:

```text
protected => keep_protected
rot_score >= 0.80 => remove_candidate
rot_score >= 0.60 => compress_candidate
otherwise => keep
```

The default `0.80` removal threshold is deliberately high. Lower it only for private validation runs where you manually review the generated report and can tolerate more aggressive candidates.

Use `summary.score_diagnostics` before changing thresholds or scoring weights. If `compress_candidate` messages are far below the removal threshold and `near_remove_threshold_count` is `0`, the conservative result is likely intentional rather than a missed deletion opportunity.

## Current Limitations

- `compress_candidate` does not rewrite messages into summaries.
- Token counts are local estimates, not exact model-tokenizer counts.
- No Web UI, MCP server, or standalone installer is included. Claude Code command/plugin wrappers are included; Codex support is skill/CLI based rather than a verified slash command.
- Real long-session validation is still ongoing, so review reports before using compressed output as a replacement context.
