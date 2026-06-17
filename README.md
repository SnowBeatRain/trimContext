# trimctx

**A local-first CLI that analyzes and safely trims long AI conversation context.**

When you use Claude Code, Codex, Cursor, or other AI assistants for hours, conversation history accumulates stale messages — old errors, superseded instructions, orphaned tool outputs, metadata noise. This is **context rot**: the conversation gets slower, more expensive, and the model starts pulling in irrelevant history.

trimctx reads your JSONL conversation files, identifies low-value or stale messages, explains why, and generates a safe compressed copy — **without ever modifying the original file**.

**Safety rule: trimctx prefers missing a deletion over deleting the wrong message.**

[中文说明](README_zh.md)

## What it looks like

```
$ trimctx analyze ~/.claude/projects/my-project/abc123.jsonl

trimctx analysis

  633 messages / 218K tokens
  health: MODERATE  rot: 10.8% (68 candidates)

  trust:
    0 remove candidates means nothing crossed the safe deletion threshold.
    compress candidates, if any, are report-only and kept by default.
    max score: 0.6428; near threshold: 0

  breakdown:
    remove:       41 messages (5.6K tokens)
    compress:     27 messages
    protected:    338 messages
    saving:       5.6K tokens (2.6%)

  top reasons:
    - metadata noise: 18
    - old content: 15
    - superseded: 12
    - orphan tool result: 8
    - low reference: 6

  next:
    trimctx compress "~/.claude/projects/my-project/abc123.jsonl" -o trimmed.jsonl
    trimctx report "~/.claude/projects/my-project/abc123.jsonl" -o report.json
    trimctx analyze "~/.claude/projects/my-project/abc123.jsonl" --json
```

## Quick Start

**Requires Node.js 20+.**

Install from npm, then install AI-client command files:

```bash
npm install -g trimctx
trimctx init
```

`trimctx init` installs Claude Code slash commands under `~/.claude/plugins/trimctx` and a Codex skill under `~/.codex/skills/trimctx`. Restart the AI client afterwards, then run `/trimctx` in Claude Code or ask Codex to use the trimctx skill.

Alternative GitHub install path:

Windows CMD:

> If CMD says `'irm' is not recognized`, you are not in PowerShell. Use this CMD command instead.

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex"
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex
```

macOS / Linux / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh | bash
```

Then restart Claude Code and run:

```text
/trimctx
```

On Windows, this installs:

- `trimctx.cmd` / `trimctx.ps1` into `%USERPROFILE%\.local\bin`
- the Claude Code plugin into `%USERPROFILE%\.claude\plugins\trimctx`
- the source checkout into `%LOCALAPPDATA%\trimctx`

On macOS / Linux, this installs:

- `trimctx` into `~/.local/bin/trimctx`
- the Claude Code plugin into `~/.claude/plugins/trimctx`
- the source checkout into `~/.local/share/trimctx`

If your shell cannot find `trimctx`, add this to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

For local development from a checkout:

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
npm link
trimctx --help
```

npm install only, without command files:

```bash
npm install -g trimctx
trimctx init --client all
trimctx --help
```

Write a full JSON report for review:

```bash
trimctx report path/to/session.jsonl -o report.json
```

Generate a compressed copy (original untouched):

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

Generate handoff artifacts for continuing the work:

```bash
trimctx handoff path/to/session.jsonl -o handoff.md --next-context next-context.md
```

Analyze the most recent Claude Code or Codex session automatically:

```bash
trimctx current
trimctx current --source claude
trimctx current --source codex
```

Analyze the most recent Claude Code session with the legacy alias:

```bash
trimctx resume
```

Install AI-client commands:

```bash
trimctx init                 # install Claude + Codex user-level assets
trimctx init --client claude # install only Claude Code commands
trimctx init --client codex  # install only the Codex skill
trimctx init --target project --dir .
```

Use it from Claude Code:

- `trimctx init` installs `plugins/trimctx/` to `~/.claude/plugins/trimctx` by default.
- The plugin exposes `/trimctx`, `/trimctx:analyze`, `/trimctx:resume`, and `/trimctx:compress` command files.
- Safety boundary: `/trimctx` analyzes the latest local JSONL by modification time. It does not write back to Claude Code, does not modify the original session, and only compresses when explicitly requested.

Use it from Codex:

- `trimctx init` installs `codex/skills/trimctx/SKILL.md` to `~/.codex/skills/trimctx` by default.
- Run `trimctx current --source codex` to analyze the latest local Codex JSONL under `~/.codex/sessions/`.
- This is intentionally documented as a skill/CLI integration, not a verified `/trimctx` Codex slash command.

Prefer developing from source? Clone the repository and run the local TypeScript entrypoint:

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
npm run dev -- analyze path/to/session.jsonl
```

## Who should use this

- **Claude Code / Codex / Cursor users** with long-running sessions that hit context limits
- **Developers** who want to understand what's filling up their AI context window
- **Teams** that want to audit and compress shared conversation logs before archiving

## How it works

1. **Parse** — Auto-detects Claude Code JSONL, OpenAI JSONL, and Codex/Hermes rollout JSONL formats.
2. **Normalize** — Unifies message structures, tool-use blocks, tool results, and metadata events.
3. **Protect** — Flags high-risk content as protected (system prompts, recent messages, user decisions, code, errors, diffs, config changes, memory instructions).
4. **Score** — Evaluates remaining messages on dimensions like age, redundancy, reference count, orphaned tool output, and metadata noise.
5. **Report** — Outputs human-readable summaries and full JSON reports with per-message decisions and reasons.
6. **Compress** — Writes a new JSONL excluding only non-protected `remove_candidate` messages.

## Commands

### `trimctx init`

Install AI-client command files and skills from the npm package.

```bash
trimctx init
trimctx init --client claude --force
trimctx init --client codex --target project --dir .
trimctx init --dry-run
```

| Flag | Default | Description |
|---|---:|---|
| `--client <client>` | `all` | `claude`, `codex`, or `all` |
| `--target <target>` | `user` | `user` installs under the home directory; `project` installs under `--dir` or the current directory |
| `--dir <directory>` | home/current | Override the base directory |
| `--force` | `false` | Overwrite existing trimctx assets |
| `--dry-run` | `false` | Print planned paths without writing files |

### `trimctx analyze <file>`

Print a terminal summary or full JSON report.

```bash
trimctx analyze session.jsonl
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

| Flag | Default | Description |
|---|---:|---|
| `--json` | `false` | Full JSON report instead of terminal summary |
| `--color` | `false` | Colorize terminal output |
| `--recent-window <N>` | `30` | Hard-protect the N most recent messages |
| `--remove-threshold <score>` | `0.80` | Minimum rot_score to mark as `remove_candidate` |
| `--compress-threshold <score>` | `0.60` | Minimum rot_score to mark as `compress_candidate` |

### `trimctx report <file> -o <report.json>`

Write a complete JSON report including per-message decisions, scores, reasons, and warnings.

```bash
trimctx report session.jsonl -o report.json
```

### `trimctx compress <file> -o <output.jsonl>`

Write a safe compressed copy. The original file is never modified.

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

| Decision | Behavior |
|---|---|
| `keep_protected` | Always kept |
| `keep` | Kept |
| `compress_candidate` | Kept (report-only for now) |
| `remove_candidate` | Removed only if not protected |

`compress_candidate` is intentionally conservative: it means trimctx found a stale or low-value signal, but not enough evidence to remove the message safely. Some formats, especially Codex/Hermes rollout files, may produce zero `remove_candidate` messages under default thresholds; treat that as a safety-first result rather than a parser failure.

### `trimctx handoff <file> -o <handoff.md>`

Write deterministic Markdown artifacts for continuing a long or noisy session without mutating the original JSONL.

```bash
trimctx handoff session.jsonl -o handoff.md --next-context next-context.md
```

### `trimctx resume`

Find and analyze the most recent Claude Code session under `~/.claude/projects/`.

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

## Supported Inputs

| Format | Status |
|---|---|
| Claude Code JSONL | Supported |
| OpenAI Chat Completion JSONL | Supported |
| Codex/Hermes rollout JSONL | Supported |
| Plain text transcripts | Not supported |
| Databases or remote APIs | Not supported |

## Safety Model

trimctx protects content that is likely still important:

- `system` and `developer` messages
- The most recent N messages (configurable, default 30)
- Memory-like instructions ("remember", "from now on", "don't forget")
- Explicit user decisions and corrections
- Code blocks, stack traces, file paths, shell commands, and git diffs
- Test failures and debugging evidence
- Architecture, API, schema, and configuration changes
- Tool results referenced later in the conversation

**Verify the original is untouched:**

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
# The two hashes should match.
```

## Current Limitations

- `compress_candidate` messages are kept as-is (no rewriting or summarizing yet).
- JSON reports include `summary.score_diagnostics` to inspect score distribution before changing thresholds; diagnostics do not change compression behavior.
- Token counts are local estimates, not model-specific tokenizer counts.
- Claude Code and Codex/Hermes rollout paths have been exercised on local samples; real multi-sample validation is still in progress, and OpenAI still needs a user-provided real export before Phase 0 is complete for every supported family. Review the report before relying on compressed output.
- Default thresholds prefer avoiding false deletions over maximizing token savings; lower thresholds only after reviewing reports against private validation samples.
- No Web UI, MCP server, or standalone installer yet. Claude Code is supported through project command files and the packaged plugin wrapper; Codex is supported through the documented skill/CLI workflow, not a verified slash command.

## Documentation

- [Usage Guide](docs/usage.md) — detailed commands, outputs, and safety verification
- [Roadmap](docs/roadmap.md) — planned milestones and features
- [Requirements](docs/requirements.md) — project scope and acceptance criteria

## Phase 0 validation

Before recommending trimctx to other users, validate it on a private multi-sample dataset:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

See `docs/phase0/phase0-plan.md`, `docs/phase0/manual-label-guide.md`, and `docs/phase0/validation-summary-template.md` for the safety-first validation process.

## Development

```bash
npm install
npm test
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code guidelines, and PR process.

## License

[MIT](LICENSE)
