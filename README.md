# trimctx

**A local-first CLI that analyzes and safely trims long AI conversation context.**

When you use Claude Code, Codex, Cursor, or other AI assistants for hours, conversation history accumulates stale messages — old errors, superseded instructions, orphaned tool outputs, metadata noise. This is **context rot**: the conversation gets slower, more expensive, and the model starts pulling in irrelevant history.

trimctx reads your JSONL conversation files, identifies low-value or stale messages, explains why, and generates a safe compressed copy — **without ever modifying the original file**.

**Safety rule: trimctx prefers missing a deletion over deleting the wrong message.**

**Release milestone:** `0.2.5` packages continuation-aware reports, handoff/next-context artifacts, optional exact `tiktoken` counting for OpenAI/Codex-family inputs, AI-client install guidance, and npm package smoke checks into one npm-ready release. It is still conservative by design: Phase 0 is not complete until broader real-sample validation and manual review metrics are finished.

[中文说明](README_zh.md)

## Quick Start

**Requires Node.js 20+.**

Install from npm, then analyze a session and prepare AI-client assets:

```bash
npm install -g trimctx
trimctx analyze path/to/session.jsonl
trimctx init
```

Use `trimctx analyze` for a short summary, `trimctx report` for the full JSON audit trail, and `trimctx compress` only after reviewing the report.

## What it looks like

```
$ trimctx analyze ~/.claude/projects/my-project/abc123.jsonl

trimctx analysis

  633 messages / 218K tokens
  token estimate: heuristic-v1 (local_heuristic, medium confidence)
  tokenizer: local_heuristic (medium confidence)
  context pressure: HIGH  removable: 5.6K tokens (2.6%)
  health: MODERATE  rot: 10.8% (68 candidates)

  trust:
    41 remove candidates crossed the safe deletion threshold.
    review the JSON report before applying destructive workflows.
    phase0: REVIEW_REQUIRED
    candidates are review-only until Phase 0 gates are locked.
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
    trimctx report "~/.claude/projects/my-project/abc123.jsonl" -o report.json
    run Phase 0 manual review before using compress output as replacement context
    trimctx analyze "~/.claude/projects/my-project/abc123.jsonl" --json
```

## Installation

For release verification, install from npm or a packed tarball in a clean prefix and confirm `trimctx --version` and `trimctx --help` run from the installed binary before running `trimctx init`.


```bash
npm install -g trimctx
trimctx --version
trimctx --help
trimctx init
```

For release verification, install from npm or a packed tarball in a clean prefix and confirm `trimctx --version` and `trimctx --help` run from the installed binary before running `trimctx init`.

`trimctx init` asks whether to install globally for the current user or into the current project. User/global install writes Claude Code slash commands under `~/.claude/plugins/trimctx` and a Codex skill under `~/.codex/skills/trimctx`. In the interactive flow it also asks whether to enable Claude current-window hooks, defaulting to yes. Non-interactive installs still require `--with-hooks` to install hooks.

For Claude Code current-window commands such as `/trimctx`, `/trimctx:handoff`, and `/trimctx:compress`, enable hooks during interactive `trimctx init`, run `trimctx init --with-hooks`, or run `trimctx install-hooks`, then restart Claude Code. The hook writes the current `transcript_path` into `TRIMCTX_TRANSCRIPT_PATH` automatically; users do not need to find or copy the JSONL path manually.

Alternative GitHub install path:

Windows CMD:

> If CMD says `'pwsh' is not recognized`, use `powershell` instead. Review the downloaded script before running it.

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

Core daily workflow:

```bash
trimctx init
trimctx current
trimctx handoff path/to/session.jsonl
```

- `trimctx init` installs the Claude Code plugin and Codex skill files.
- `trimctx current` analyzes the latest local Claude Code or Codex session by file modification time.
- `trimctx handoff <file>` creates a UID-based continuation package you can reference later.

Claude Code current-window workflow:

```bash
trimctx init
# restart Claude Code, then run these inside Claude Code:
/trimctx
/trimctx:handoff
```

Need deeper inspection? Use `trimctx analyze <file>` for a direct file summary and `trimctx report <file> -o report.json` for the full JSON audit trail. Use `trimctx compress` only after reviewing the report; compression remains conservative and never modifies the original file.

## Continuation-aware handoff

`trimctx analyze`, `trimctx report`, and `trimctx current` include a local continuation state in their reports. The extractor is rule-based and does not call external LLMs or APIs.

The continuation state is a best-effort, heuristic continuation aid after a long session:

- `tokenization` records the tokenizer name and confidence used for token estimates. By default trimctx uses the local heuristic tokenizer. When the optional `js-tiktoken` package is installed, OpenAI-style and Codex/Hermes rollout inputs can use exact local `tiktoken` counts with high confidence.
- `resume.readiness` scores whether the session has enough continuation signals.
- `resume.currentGoal`, `decisions`, `activeFiles`, `failures`, `testSignals`, and `nextSteps` preserve likely continuation signals after compaction.
- `trimctx handoff <file>` writes a uid-based package under `.trimctx/handoffs/<uid>/` with `handoff.md`, `next-context.md`, `manifest.json`, and `report.json`. In Claude Code with hooks installed, `/trimctx:handoff` calls `trimctx handoff` without a file because `TRIMCTX_TRANSCRIPT_PATH` is injected for the current window.
- The printed `uid` is a copyable reference for follow-up work, but trimctx does not currently provide `resume <uid>` or an equivalent restore command.

The original JSONL session is still read-only. Resume extraction only affects reports and generated Markdown artifacts. Review generated handoffs before sharing or pasting them into another session; rule-based extraction can miss, misclassify, or redact imperfectly.

Analyze the most recent Claude Code or Codex session automatically:

```bash
trimctx current
trimctx current --source claude
trimctx current --source codex
```

Install AI-client commands:

```bash
trimctx init                 # choose user/global or project install interactively
trimctx init --target user --client claude    # install only Claude Code commands for this user
trimctx init --target user --client codex     # install only the Codex skill for this user
trimctx init --target project --dir .
trimctx init --with-hooks    # experimental: also install Claude current-window hooks
trimctx init --no-hooks      # skip Claude hooks when prompted
trimctx install-hooks        # experimental: install hooks only
```

Use it from Claude Code:

- `trimctx init` prompts for user/global or project install; `--target user` installs `plugins/trimctx/` to `~/.claude/plugins/trimctx`.
- The plugin exposes `/trimctx`, `/trimctx:analyze`, `/trimctx:handoff`, and `/trimctx:compress` command files.
- `/trimctx`, `/trimctx:handoff`, and `/trimctx:compress` require `TRIMCTX_TRANSCRIPT_PATH`, which is written by the Claude `SessionStart` hook installed through interactive `trimctx init`, `trimctx init --with-hooks`, or `trimctx install-hooks`.
- Safety boundary: current-window commands do not fall back to `trimctx current`. If the hook binding is missing, they stop and ask for hooks to be installed. They do not write back to Claude Code, do not modify the original session, and only compress when explicitly requested.

Use it from Codex:

- `trimctx init` prompts for user/global or project install; `--target user` installs `codex/skills/trimctx/SKILL.md` to `~/.codex/skills/trimctx`.
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

### Core commands

#### `trimctx init`

Install AI-client command files and skills from the npm package. When `--target` is omitted in an interactive terminal, `trimctx init` prompts for user/project install and then asks whether to enable Claude current-window hooks, defaulting to yes. Non-interactive installs do not install hooks unless `--with-hooks` is supplied.

```bash
trimctx init
trimctx init --client claude --force
trimctx init --client codex --target project --dir .
trimctx init --dry-run
```

| Flag | Default | Description |
|---|---:|---|
| `--client <client>` | `all` | `claude`, `codex`, or `all` |
| `--target <target>` | prompts | `user` installs under the home directory; `project` installs under `--dir` or the current directory |
| `--dir <directory>` | home/current | Override the base directory |
| `--force` | `false` | Overwrite existing trimctx assets |
| `--dry-run` | `false` | Print planned paths without writing files |
| `--with-hooks` | `false` | Experimental: also install Claude current-window hooks |
| `--no-hooks` | `false` | Skip Claude hook installation when running interactive init |

#### `trimctx current`

Analyze the most recent Claude Code or Codex session automatically. This is latest-file discovery by modification time, not a current-window API.

```bash
trimctx current
trimctx current --source claude
trimctx current --source codex
```

#### `trimctx handoff [file]`

Write deterministic Markdown artifacts for continuing a long or noisy session without mutating the original JSONL.

```bash
trimctx handoff session.jsonl
trimctx handoff   # only when TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session
```

By default, this creates `.trimctx/handoffs/<uid>/` with `handoff.md`, `next-context.md`, `manifest.json`, and `report.json`. The UID uses UTC time (`ctx_YYYYMMDD_HHMMSS_xxxxxx`) and is printed as `copyable uid: ...` for easy handoff references. `manifest.json` includes absolute file paths for local automation plus relative file names for moving or archiving the package. Use `--out <dir>` to place packages under a custom root; legacy single-file output remains available with `-o handoff.md --next-context next-context.md`. Handoff packages may include original transcript content and secrets in `report.json`; review before sharing. The UID is a reference for follow-up work, not a restore token; trimctx does not currently provide `resume <uid>` or an equivalent command.

### Diagnostic commands

#### `trimctx analyze [file]`

Print a terminal summary or full JSON report.

```bash
trimctx analyze session.jsonl
trimctx analyze   # only when TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session
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

### Advanced audit commands

#### `trimctx report <file> -o <report.json>`

Write a complete JSON report including per-message decisions, scores, reasons, warnings, top-level `phase0_trust`, and top-level `parser_diagnostics`.

```bash
trimctx report session.jsonl -o report.json
```

### Experimental compression command

#### `trimctx compress <file> -o <output.jsonl>`

Write a safe compressed copy. The original file is never modified.

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

| Decision | Behavior |
|---|---|
| `keep_protected` | Always kept |
| `keep` | Kept |
| `compress_candidate` | Kept (report-only for now) |
| `remove_candidate` | Removed from the copy only if not protected; review-only until Phase 0 gates are locked |

`compress_candidate` is intentionally conservative: it means trimctx found a stale or low-value signal, but not enough evidence to remove the message safely. `remove_candidate` is also a candidate for human review until Phase 0 trust is locked. Some formats, especially Codex/Hermes rollout files, may produce zero `remove_candidate` messages under default thresholds; treat that as a safety-first result rather than a parser failure.

### Experimental integration commands

#### `trimctx hook`

Run as a Claude Code hook executor, not as the primary user-facing analysis command. As a Stop hook, it requires Claude hook input containing `transcript_path` and does not fall back to latest-file discovery. As an internal SessionStart hook, `trimctx hook --session-start` persists `transcript_path` and `session_id` into `TRIMCTX_TRANSCRIPT_PATH` and `TRIMCTX_SESSION_ID` through `CLAUDE_ENV_FILE`, so slash commands can target the current Claude window without asking the user for a JSONL path.

#### `trimctx install-hooks`

Install the experimental Claude Code SessionStart and Stop hooks into `settings.json`. Use it when assets are already installed and you only need to add or repair hooks. Interactive `trimctx init` can install the same hooks during setup; non-interactive init requires `--with-hooks`.

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
- Token counts use the zero-dependency local heuristic by default. Installing the optional `js-tiktoken` package enables exact local `tiktoken` counts for OpenAI-style and Codex/Hermes rollout inputs, without calling a vendor API.
- Claude Code and Codex/Hermes rollout paths have been exercised on local samples; real multi-sample validation is still in progress, and OpenAI still needs a user-provided real export before Phase 0 is complete for every supported family. Review the report before relying on compressed output.
- `trimctx current` is latest-file discovery only. Claude Code current-window behavior requires the hook-provided `TRIMCTX_TRANSCRIPT_PATH`; Codex current-window transcript binding is not currently documented as verified support.
- Default thresholds prefer avoiding false deletions over maximizing token savings; lower thresholds only after reviewing reports against private validation samples.
- No Web UI, MCP server, or standalone installer yet. Claude Code is supported through the packaged plugin wrapper; Codex is supported through the documented skill/CLI workflow, not a verified slash command.

## Documentation

- [Usage Guide](docs/user/usage.md) — detailed commands, outputs, and safety verification
- [Roadmap](docs/dev/roadmap.md) — planned milestones and features
- [Requirements](docs/dev/requirements.md) — project scope and acceptance criteria

## Phase 0 validation

Before recommending trimctx to other users, validate it on a private multi-sample dataset:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

See `docs/dev/phase0/phase0-plan.md`, `docs/dev/phase0/manual-label-guide.md`, and `docs/dev/phase0/validation-summary-template.md` for the safety-first validation process.

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
