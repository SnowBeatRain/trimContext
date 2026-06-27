# Usage Guide

This guide explains how to run trimctx safely against local Claude Code, OpenAI, or Codex/Hermes rollout JSONL conversation files.

[中文版](usage_zh.md)

## Quick Start

```bash
npm install -g trimctx
trimctx analyze path/to/session.jsonl
trimctx init
```

trimctx is local-only: it does not call an LLM, upload files, or use a database. Token counting also stays local: the built-in `local_heuristic` tokenizer is the default, and the optional `js-tiktoken` package enables exact local counts for OpenAI-style and Codex/Hermes rollout inputs without calling a vendor API.

## Requirements

- Node.js 20 or later
- A JSONL conversation file from Claude Code, an OpenAI-style chat export, or a Codex/Hermes rollout export

trimctx is local-only: it does not call an LLM, upload files, or use a database. Token counting also stays local: the built-in `local_heuristic` tokenizer is the default, and the optional `js-tiktoken` package enables exact local counts for OpenAI-style and Codex/Hermes rollout inputs without calling a vendor API. The current `0.2` series is a packaging and continuation milestone, not a Phase 0 completion claim; keep reviewing reports before relying on compression output.

If you install `trimctx` globally and want exact `tiktoken` counts, install `js-tiktoken` in the same resolvable environment as the CLI, or use a project-local `trimctx` install with a project-local `js-tiktoken` dependency.

## Installation

### One-command GitHub install

This path does not require publishing trimctx to npm.

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

On Windows, it installs CLI shims at `%USERPROFILE%\.local\bin`, installs the Claude Code plugin at `%USERPROFILE%\.claude\plugins\trimctx`, and keeps the source checkout at `%LOCALAPPDATA%\trimctx`.

On macOS / Linux, it installs the CLI at `~/.local/bin/trimctx`, installs the Claude Code plugin at `~/.claude/plugins/trimctx`, and keeps the source checkout at `~/.local/share/trimctx`.

Restart Claude Code after installation, then run:

```text
/trimctx
```

If your shell cannot find `trimctx`, add `~/.local/bin` to `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

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

### npm install

Install the CLI and then install AI-client command files:

```bash
npm install -g trimctx
trimctx --version
trimctx --help
trimctx init
trimctx analyze path/to/session.jsonl
```

For release verification, install from npm or a packed tarball in a clean prefix and confirm the installed `trimctx --version` and `trimctx --help` commands run before installing AI-client assets.

`trimctx init` installs Claude Code command files and the Codex skill from the npm package. It prompts for user/global versus project install when `--target` is omitted. In that interactive flow it also asks whether to enable Claude current-window hooks, defaulting to yes. Non-interactive installs do not install hooks unless `--with-hooks` is supplied. Use `trimctx init --dry-run` to inspect paths before writing.

Claude Code current-window commands require hooks. The `SessionStart` hook writes the current `transcript_path` to `TRIMCTX_TRANSCRIPT_PATH` through `CLAUDE_ENV_FILE`, so users can run `/trimctx` or `/trimctx:handoff` without finding the JSONL path manually.

## Quick Start

Analyze a file and print a short summary:

```bash
trimctx analyze path/to/session.jsonl
```

Typical summary shape:

```text
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

  next:
    trimctx report "<file>" -o report.json
    run Phase 0 manual review before using compress output as replacement context
    trimctx analyze "<file>" --json
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
trimctx handoff path/to/session.jsonl
```

From Claude Code with hooks installed, `/trimctx:handoff` calls `trimctx handoff` without a file argument because `TRIMCTX_TRANSCRIPT_PATH` is already bound to the current window.

## Recommended Workflow

1. Run `analyze` to see whether trimctx finds meaningful candidates.
2. Run `report` and inspect the reasons for `remove_candidate` messages.
3. Keep the original JSONL file unchanged.
4. Run `compress` with `-o` to create a new file only after review; before Phase 0 trust is locked, treat that output as a review artifact rather than replacement context.
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
npm run --silent phase0:review -- --reports reports/phase0 --labels datasets/private/phase0-labels --out reports/phase0
```

`phase0:review` is a repository development script; run it from a source checkout, not from a globally installed `trimctx` package. The script writes `reports/phase0/phase0-review.json` and `reports/phase0/phase0-review.md`. Its `trust_status` is `review_required` while labels, label references, or metrics are incomplete, `locked` only when all gates pass, and `failed` when review completes but a metric gate fails. Protected review is intentionally scoped: all critical protected messages must be labeled, while non-critical protected messages are checked by representative sampling.

The workflow is documented in `docs/dev/phase0/phase0-plan.md`, `docs/dev/phase0/manual-label-guide.md`, and `docs/dev/phase0/validation-summary-template.md`.

`reports/phase0/phase0-results.json` is private by default. It can include local paths plus captured `stderr` or `error` details, so publish only a sanitized summary or manually redacted excerpt.

## Commands

### `trimctx init`

Install AI-client command files and skills from the installed package.

```bash
trimctx init
trimctx init --client claude
trimctx init --client codex --target project --dir .
trimctx init --dry-run
```

By default, `trimctx init` prompts for user/global or project install. With `--target user`, Claude Code assets go to `~/.claude/plugins/trimctx` and Codex skill assets go to `~/.codex/skills/trimctx`. Existing assets are not overwritten unless `--force` is provided.

Interactive `trimctx init` also prompts whether to enable Claude current-window hooks and recommends yes. Pass `--no-hooks` to skip them explicitly. If you pass `--target` or run in a non-interactive shell, hooks are installed only when `--with-hooks` is supplied.

### `trimctx analyze [file]`

Analyze a Claude Code, OpenAI, or Codex/Hermes rollout JSONL conversation and print a terminal summary.

```bash
trimctx analyze session.jsonl
trimctx analyze   # only when TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session
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
- `tokenization` — tokenizer name and confidence; `local_heuristic` means a local estimate, while optional `js-tiktoken` enables exact high-confidence local counts for OpenAI-style and Codex/Hermes rollout inputs.
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

### `trimctx handoff [file]`

Write deterministic Markdown artifacts for continuing a long or noisy session without mutating the original JSONL.

```bash
trimctx handoff session.jsonl
trimctx handoff   # only when TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session
```

By default, trimctx writes a uid-based package under `.trimctx/handoffs/<uid>/`. The package includes the primary handoff, a shorter continuation context, a machine-readable manifest, and the full JSON report. The UID uses UTC time (`ctx_YYYYMMDD_HHMMSS_xxxxxx`) and is printed as `copyable uid: ...` so it can be pasted into follow-up instructions. `manifest.json` stores absolute file paths for local automation and relative file names for moving or archiving the package. Use `--out <dir>` to place packages under a custom root. Legacy single-file output is still available with `-o handoff.md --next-context next-context.md`. Review the package before sharing because `report.json` may include original transcript content and secrets. The UID is a reference for follow-up work, not a restore token; trimctx does not currently provide `resume <uid>` or an equivalent command.

Example `handoff.md` output:

```markdown
# trimctx Handoff

## Source
- File: path/to/session.jsonl
- Format: claude-code-jsonl
- Messages: 633
- Estimated tokens: 218385

## Safety Summary
- Remove candidates: 41
- Compress candidates: 30
- Protected messages: 338
- Estimated removable tokens: 5592
- Max rot score: 0.6428
- Near remove threshold: 0

## Continue From Here
- Treat `remove_candidate` as the only class eligible for destructive workflows...
- Treat `compress_candidate` as report-only review signal...
- Keep original JSONL unchanged...
- If remove candidates are zero, continue from the health report...

## Candidate Review Queue
- line 42, user, score 0.8500: old_message, low_reference_in_later_context
- line 58, assistant, score 0.8200: superseded_by_later_instruction, old_message
...

## Protected High-Rot Signals
- line 301, user, score 0.6500: contains_code_block, old_message

## Warnings
- This handoff package may include original transcript content and secrets; review it before sharing or pasting into another system.
- session_compacted: session contains away_summary or compact_boundary markers

## Commands
- `trimctx analyze "path/to/session.jsonl"`
- `trimctx report "path/to/session.jsonl" -o report.json`
- `trimctx compress "path/to/session.jsonl" -o trimmed.jsonl`
```

Example `next-context.md` output:

```markdown
# Next Context

Use this as the compact handoff for the next agent or session.

## Current State
- Source file: path/to/session.jsonl
- Source format: claude-code-jsonl
- Messages analyzed: 633
- Remove candidates: 41
- Compress candidates: 30

## Operating Rules
- Do not modify the original JSONL file.
- Review remove candidates before applying any destructive workflow.
- Use score diagnostics as trust signals, not as automatic tuning instructions.

## Next Commands
- `trimctx analyze "path/to/session.jsonl"`
- `trimctx report "path/to/session.jsonl" -o report.json`
- `trimctx handoff "path/to/session.jsonl"`
```

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

`trimctx current` is latest-file discovery. It is not a current-window API and should not be used as a fallback for Claude Code slash commands that need the active transcript.

## Client Integrations

### Claude Code

The npm package includes `plugins/trimctx/`, which is the supported Claude Code plugin asset source. `trimctx init` installs that plugin into the selected user or project location. These commands call the `trimctx` executable, so install the CLI globally or run `npm link` during local development.

Current-window boundary: `/trimctx`, `/trimctx:handoff`, and `/trimctx:compress` require `TRIMCTX_TRANSCRIPT_PATH`, which is set by the internal `trimctx hook --session-start` executor when Claude Code runs the installed `SessionStart` hook. If that binding is missing, the plugin must stop and ask the user to enable hooks through interactive `trimctx init`, `trimctx init --with-hooks`, or `trimctx install-hooks`, then restart Claude Code.

Safety boundary: these commands analyze local JSONL files. They do not write back into Claude Code sessions, and they do not compress unless the user chooses `/trimctx:compress` or an explicit CLI compression command.

### `trimctx hook`

Run as a Claude Code hook executor. This is the command Claude Code calls after hook installation, not a primary user-facing analysis command. As a Stop hook, it requires `transcript_path` from Claude hook input and does not fall back to latest-file discovery. As an internal SessionStart hook, `trimctx hook --session-start` persists `transcript_path` and `session_id` into `TRIMCTX_TRANSCRIPT_PATH` and `TRIMCTX_SESSION_ID` using `CLAUDE_ENV_FILE`.

### `trimctx install-hooks`

Install the experimental Claude Code SessionStart and Stop hooks into `settings.json`. Use it when AI-client assets are already installed and you only need to add or repair hooks. Interactive `trimctx init` can install the same hooks during setup; non-interactive init requires `--with-hooks`.

### Codex

The package includes `codex/skills/trimctx/SKILL.md`, which provides a Codex-supported skill entry point for the CLI workflow. This is not documented as a verified Codex `/trimctx` slash command; use the skill or run `trimctx current --source codex` directly. Codex discovery currently scans `~/.codex/sessions/` only. Do not claim Codex current-window transcript binding unless an integration explicitly provides a trusted `TRIMCTX_TRANSCRIPT_PATH`.

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

| Dimension | Weight | Description |
|---|---:|---|
| `superseded_score` | 0.30 | Later messages override or correct earlier instructions |
| `low_reference_score` | 0.25 | The message is not referenced by later context |
| `age_score` | 0.20 | Older messages receive more decay |
| `redundancy_score` | 0.15 | The message is similar to nearby content (±3 messages) |
| `orphan_tool_score` | 0.10 | Tool calls or results are not connected to later context |
| `low_value_score` | — | Metadata, acknowledgments, or low-information content (independent path, not part of weighted sum) |

Combined formula:

```text
base_rot_score = 0.30 × superseded + 0.25 × low_reference + 0.20 × age + 0.15 × redundancy + 0.10 × orphan_tool
rot_score = max(base_rot_score, low_value_score) − importance_discount
```

Importance discounts (subtracted from `rot_score` to protect important content):

| Protection signal | Discount |
|---|---:|
| Code block, error stack, git diff, test failure | −0.15 |
| Shell command, architecture/API/config decision | −0.10 |
| Tool result referenced later | −0.10 |
| File path | −0.05 |
| Natural language referencing tool result | −0.05 |

Decision mapping:

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
- Current-window targeting is only implemented for Claude Code through hook-provided `TRIMCTX_TRANSCRIPT_PATH`. `trimctx current` remains latest-file discovery.
- Real long-session validation is still ongoing, so review reports before using compressed output as a replacement context.
