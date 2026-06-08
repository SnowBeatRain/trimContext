# Usage Guide

This guide covers installing, running, and understanding trimctx CLI commands.

[中文版](usage_zh.md)

## Requirements

- Node.js 20 or later

## Installation

### npm (when published)

```bash
npm install -g trimctx
```

### From source

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

## Quick Start

```bash
trimctx analyze path/to/session.jsonl
```

Expected output:

```text
trimctx analysis

messages: 633
tokens: 218,385
protected: 338
remove candidates: 41
compress candidates: 30
estimated saving: 5,592 tokens (2.56%)

top reasons:
- recent_message: 241
- superseded_by_later_instruction: 195
- old_message: 190

next:
- trimctx report <file> -o report.json
- trimctx compress <file> -o output.jsonl
```

## Commands

### `trimctx analyze <file>`

Analyzes a JSONL conversation file and prints a summary.

**Options:**

| Flag | Description |
|---|---|
| `--json` | Output full JSON report instead of summary |

```bash
# Short summary (default)
trimctx analyze session.jsonl

# Full JSON report
trimctx analyze session.jsonl --json
```

### `trimctx report <file> -o <report.json>`

Writes a complete JSON report to a file. The report includes:

- **input** — source file metadata
- **summary** — total messages, tokens, protected count, candidates, estimated savings
- **messages** — per-message tokens, decision, reasons, and scores
- **remove_candidates** — list of messages safe to remove
- **warnings** — any issues encountered during analysis

```bash
trimctx report session.jsonl -o report.json
```

### `trimctx compress <file> -o <output.jsonl>`

Generates a compressed copy of the conversation. Only non-protected `remove_candidate` messages are excluded.

**The original file is never modified.**

The `-o` flag is required — you must specify where to write the output.

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

**Deletion rules:**

| Decision | Action |
|---|---|
| `keep_protected` | Kept |
| `keep` | Kept |
| `compress_candidate` | Kept (not deleted in v0.1) |
| `remove_candidate` | Removed, only if not protected |

## Supported Input Formats

| Format | Status |
|---|---|
| Claude Code JSONL | Supported |
| OpenAI Chat Completion JSONL | Supported |

## Safety Model

trimctx protects the following content by default. These messages are never removed:

- `system` / `developer` messages
- Recent 6 turns of `user` / `assistant` messages
- Code blocks, error stacks, file paths, shell commands, git diffs
- Test failure messages
- Memory-class instructions ("remember", "from now on", "don't forget")
- Explicit user decisions
- Architecture / API / schema / configuration changes
- Tool results referenced by subsequent natural-language summaries

## Verifying Safety

After running `compress`, verify that the original file was not modified:

```bash
# Linux / macOS
sha256sum session.jsonl

# Windows PowerShell
Get-FileHash -Algorithm SHA256 -LiteralPath "session.jsonl"
```

Run the hash check before and after `compress` — they must match.

## Scoring Dimensions

Each message is scored across multiple dimensions:

| Dimension | Description |
|---|---|
| `superseded_score` | Later messages override or correct earlier instructions |
| `low_reference_score` | Not referenced by subsequent messages |
| `age_score` | Exponential decay based on position in conversation |
| `redundancy_score` | High similarity with nearby messages |
| `orphan_tool_score` | Tool calls/results not connected to later context |
| `low_value_score` | Metadata, acknowledgments, or low-information content |

The combined `rot_score` determines the decision:

```text
protected => keep_protected
rot_score >= 0.80 => remove_candidate
rot_score >= 0.60 => compress_candidate
otherwise => keep
```

## Limitations

- `analyze` summary output is available in v0.2+; v0.1 outputs full JSON
- No automatic session discovery (`latest` / `sessions` planned for v0.2)
- No environment diagnostics (`doctor` planned for v0.2)
- No AI tool integrations (planned for v0.3+)
