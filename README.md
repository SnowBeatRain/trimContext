# trimctx

A local CLI tool for analyzing and safely trimming long AI conversation context. It reads Claude Code / OpenAI JSONL conversation logs, identifies stale, redundant, low-value, and unreferenced context, outputs auditable reports, and generates safe compressed copies.

**Core principle: better to miss a deletion than delete by mistake.** The original JSONL is never modified by `compress`.

## Features

- **Analyze** conversations to detect stale, superseded, and low-value messages
- **Report** full JSON reports with per-message scoring and reasons
- **Compress** safely — writes a new file, never touches the original
- **Local-first** — no network, no LLM calls, no data uploads
- **Auditable** — every candidate has a human-readable reason
- Supports **Claude Code JSONL** and **OpenAI JSONL** formats

## Quick Start

```bash
npm install -g trimctx
```

Analyze a conversation:

```bash
trimctx analyze path/to/session.jsonl
```

Write a full report:

```bash
trimctx report path/to/session.jsonl -o report.json
```

Generate a safe compressed copy:

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

## Installation

### From npm (when published)

```bash
npm install -g trimctx
```

### From source

Requires Node.js 20+.

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

Run from source:

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

Or after building:

```bash
node dist/cli.js analyze path/to/session.jsonl
```

## Commands

### `trimctx analyze <file>`

Analyzes a JSONL conversation and outputs a summary to stdout.

- Default: human-readable short summary
- `--json`: full JSON report

### `trimctx report <file> -o <report.json>`

Writes a complete JSON report including per-message tokens, decisions, reasons, and scores.

### `trimctx compress <file> -o <output.jsonl>`

Writes a new JSONL file with only the safe-to-remove messages excluded. The `-o` flag is required.

| Decision | Action |
|---|---|
| `keep_protected` | Kept |
| `keep` | Kept |
| `compress_candidate` | Kept (not deleted in v0.1) |
| `remove_candidate` | Removed (only if not protected) |

## Supported Formats

| Format | Status |
|---|---|
| Claude Code JSONL | Supported |
| OpenAI Chat Completion JSONL | Supported |
| Plain text / Database / Remote API | Not supported |

## Safety Model

The following content is protected by default and never removed:

- `system` / `developer` messages
- Recent 6 turns of `user` / `assistant` messages
- Code blocks, error stacks, file paths, shell commands, git diffs
- Test failure messages
- Memory-class instructions ("remember", "from now on", "don't forget")
- Explicit user decisions
- Architecture / API / schema / configuration changes
- Tool results referenced by subsequent natural-language summaries

## Documentation

- [Usage Guide](docs/usage.md) — detailed installation, commands, and output formats
- [Roadmap](docs/roadmap.md) — version milestones and release criteria

## Development

```bash
npm install
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

[MIT](LICENSE)
