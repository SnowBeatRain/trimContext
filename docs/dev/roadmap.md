# trimctx Roadmap

## Purpose

trimctx is a local context-trimming tool for long AI coding sessions. It analyzes AI conversation JSONL files, identifies stale or low-value context, and writes safe compressed copies without modifying the original transcript.

The open-source goal is to make trimctx useful to other developers who run long Claude Code, Codex, or similar agent sessions and need a trustworthy way to inspect and reduce context bloat.

For product requirements and boundaries, see `docs/dev/requirements.md`.
For CLI usage, see `docs/user/usage.md`.
For the task-level execution plan, dataset requirements, validation criteria, and current task breakdown, see `docs/dev/execution-plan.md`.
For the team-reviewed iteration priorities and quality gates, see `docs/dev/iteration-plan.md`.

## Non-goals

- Do not edit original conversation files.
- Do not auto-delete protected content.
- Do not depend on one AI vendor in the core engine.
- Do not ship opaque "AI magic" scoring without explainable reasons.
- Do not prioritize installers before the core analysis is trustworthy on real sessions.

## Product Layers

1. Core Engine
   - Parse supported transcript formats.
   - Count approximate tokens.
   - Apply safety rules.
   - Score stale, duplicate, superseded, and low-value messages.
   - Produce reports.
   - Write compressed copies.

2. CLI
   - Expose stable commands for analyze, report, compress, resume, current-session discovery, and deterministic handoff artifacts.
   - Keep default output readable for humans.
   - Keep full JSON available for automation.
   - Treat diagnostics, active-session mutation, hooks, Web UI, and MCP as post-Phase-0 candidates, not the current mainline.

3. AI Integrations
   - Install slash commands or hooks for Claude Code.
   - Later support Codex, Cursor, MCP servers, and other agent hosts.

4. Open-source Operations
   - Documentation, license, changelog, CI, examples, npm packaging, and release process.

## Stage Overview

| Stage | Name | Outcome |
| --- | --- | --- |
| v0.1 | Core CLI | Local files can be analyzed, reported, and compressed safely. |
| v0.2 | Usable CLI | Real users can run trimctx without reading huge JSON output. |
| v0.3 | Claude Code Integration | Users can use hooks/status line or installed commands during Claude Code sessions. |
| v0.4 | Open Source Ready | Repository is ready for public release and npm publication. |
| v0.5 | Enhanced Detection / Multi-platform | Core engine supports heavier detectors and more AI tool integrations. |

## v0.1: Core CLI

### Goal

Prove that trimctx can safely analyze local Claude Code, OpenAI, and Codex/Hermes rollout JSONL transcripts, then validate the supported families with private real-session samples during Phase 0.

### Deliverables

- `trimctx analyze <file>`
- `trimctx report <file> -o <report.json>`
- `trimctx compress <file> -o <output.jsonl>`
- Claude Code JSONL parser
- OpenAI JSONL parser
- Codex/Hermes rollout JSONL parser
- Approximate tokenizer
- Safety rule engine
- Rot/staleness scorer
- JSON report schema
- Compressor that writes a new JSONL copy
- Automated tests for parser, safety, scorer, reporter, and compressor

### Acceptance Criteria

- `npm test` passes.
- `npm run build` passes.
- Real Claude Code long-session sample can be parsed.
- `compress` never modifies the original JSONL.
- Protected messages are never removed.
- Report reasons explain why each candidate was kept, compressed, or removable.

### Current Status

Implemented. The core CLI now supports Claude Code, OpenAI, and Codex/Hermes rollout JSONL inputs. The real Claude Code long-session sample with 633 messages produces useful candidates after safety/scorer tuning:

- protected messages: 338
- remove candidates: 41
- compress candidates: 30
- estimated saving: 5,592 tokens

### Remaining v0.1 Work

- Add regression tests for real-session edge cases using sanitized fixtures.
- Add report summary helpers for top reasons and top candidate categories.
- Keep `compress_candidate` report-only in v0.1; decide on later summarization only after private validation shows safe precision across supported formats.

## v0.2: Usable CLI

### Goal

Make the CLI comfortable for real users, not just internal validation.

### Deliverables

- Human-readable default output for `trimctx analyze <file>`.
- `trimctx analyze <file> --json` for full JSON output.
- `trimctx report <file> -o <report.json>` remains the full machine-readable report path.
- `trimctx resume` analyzes the most recent Claude Code transcript.
- `trimctx current --source codex` analyzes the latest Codex session from the documented local path.
- `trimctx handoff <file>` writes deterministic UID-based continuation packages without LLM calls.
- Better error messages for unsupported JSONL, unreadable files, and unsafe output paths.
- Advanced threshold flags exist for validation/tuning, but the default path should remain conservative and simple.
- Zero `remove_candidate` results on a real sample are acceptable when messages do not cross the stricter removal threshold; document this as conservative safety behavior rather than treating it as parser failure.

### User Experience

```bash
trimctx analyze session.jsonl
```

Expected default output:

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

### Acceptance Criteria

- `analyze` output fits in a terminal screen for large sessions.
- `analyze --json` preserves current full JSON behavior.
- `resume` works for the latest Claude Code session.
- Tests cover human summary output and JSON output separately.
- Threshold/options validation is covered for invalid values and unsafe combinations.
- Phase 0 validation records manual review metrics for critical false deletion count, protected recall, and remove candidate precision.
- Real private OpenAI export validation is recorded before claiming Phase 0 complete.

### Not Included

- Packaged slash command installation.
- Background monitoring.
- Multi-platform integrations.

## v0.3: Claude Code Integration

Current status: deferred. Per `docs/dev/iteration-plan.md`, do not start installation, hooks, status line, MCP, Web UI, or LLM summarization work until v0.2 validation and trust signals are stable.

### Goal

Let users use trimctx from inside Claude Code without manually finding JSONL files.

### Deliverables

- `trimctx install claude-code`
- Claude Code slash command file for `/trimctx`
- `/trimctx` summary command
- `/trimctx report`
- `/trimctx compress`
- `trimctx install-hooks`
- `trimctx hook`
- `trimctx statusline`
- Safe output location for generated reports and compressed copies
- Uninstall or repair behavior for the installed command

### User Experience

```bash
npx trimctx@latest install claude-code
```

Then inside Claude Code:

```text
/trimctx
```

### Acceptance Criteria

- Install command is idempotent.
- Installed slash command points to the local package correctly.
- `/trimctx` uses the current or latest session automatically.
- Hooks use `transcript_path` from Claude Code hook input instead of guessing the active session.
- Status line output is fast and short.
- Generated files are placed outside the original transcript path.
- Installation instructions work on Windows first, then macOS/Linux.

### Not Included

- Automatic compression.
- Cross-agent integrations.
- Heavy semantic scoring.

## v0.4: Open Source Ready

### Goal

Prepare the repository for public release and npm publication.

### Deliverables

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- npm package metadata:
  - repository
  - keywords
  - files or `.npmignore`
  - package description
  - license
- CI workflow for tests and build.
- Sanitized fixtures.
- Example reports.
- Release checklist.
- Safety disclaimer.

### README Must Cover

- What trimctx does.
- What trimctx does not do.
- Quick start.
- CLI commands.
- Safety model.
- Examples.
- Supported transcript formats.
- How compression works.
- How to verify that original files are not modified.

### Open-source Release Gate

- `npm test` passes in CI.
- `npm run build` passes in CI.
- Package can be installed from a packed tarball with `npm pack`.
- README quick start works from a fresh clone.
- No private real transcript is committed.
- No generated validation output is committed.
- License is selected and declared in `package.json`.

### Not Included

- Guaranteed stable public API.
- Plugin ecosystem.
- Hosted service.

## v0.5: Enhanced Detection / Multi-platform

Current status: later candidate only. Do not treat these items as active work until the core CLI validation loop proves the current safety model is trustworthy.

### Goal

Keep the core engine vendor-neutral and expand integrations or heavier detection engines after the CLI and Claude Code path are stable.

### Candidate Deliverables

- Python SDK or sidecar for heavier optional detection.
- Semantic or nonsense detectors.
- `trimctx install codex`
- `trimctx install mcp`
- Codex transcript adapter if needed.
- Cursor or generic agent transcript adapter.
- MCP server exposing analyze/report/compress operations.
- Shared integration contract for locating active sessions.

### Acceptance Criteria

- Core parser/scorer/compressor APIs remain independent from integration code.
- Each platform adapter has fixtures and tests.
- Platform-specific code can fail without breaking the core CLI.

## Current Priority

The next project phase should finish Phase 0 validation and stabilize the current CLI before investing further in installers or additional discovery commands:

1. Complete multi-sample private real-session validation.
2. Produce a validation summary with protected/remove/compress ratios, top reasons, and manual review notes.
3. Re-run real-session validation after each scoring/safety change.
4. Keep `analyze`, `analyze --json`, `report`, `compress`, and `resume` as the active CLI surface.
5. Re-evaluate additional session discovery or diagnostics commands only after Phase 0 evidence shows they are necessary.

Only after this should v0.3 installation work begin.

## Repository Hygiene Before Public Release

- Remove or ignore local validation output such as `tmp-real-validation/`.
- Keep real user transcripts out of the repository.
- Use sanitized fixtures in `tests/fixtures/`.
- Keep generated `dist/` policy explicit: either publish built files or build during release, but do not leave it ambiguous.
- Add CI before inviting contributors.
- Keep issue templates focused on bugs, false positives, false negatives, and transcript format support.

## Release Checklist

Before any public release:

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm pack`
- [ ] Install packed package in a temporary directory.
- [ ] Run `trimctx analyze` on a sanitized fixture.
- [ ] Run `trimctx report` on a sanitized fixture.
- [ ] Run `trimctx compress` on a sanitized fixture.
- [ ] Confirm original fixture hash is unchanged after compression.
- [ ] Review package contents from `npm pack --dry-run`.
- [ ] Confirm README quick start matches the shipped CLI.
