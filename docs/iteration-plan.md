# trimctx Iteration Plan

## Decision

This plan records the team review after the first real Codex/Hermes validation pass and the `score_diagnostics` implementation.

The next iteration should not chase aggressive deletion, installers, hooks, MCP, Web UI, or LLM summarization. The next iteration should make trimctx a trustworthy local context health checker first, then expand toward workflow integration only after safety evidence is strong.

## Product Positioning

trimctx should be positioned as:

> A local-first, explainable context health checker and safe compression assistant for long Claude Code, Codex, OpenAI, and similar agent transcripts.

The immediate value is not maximum token savings. The immediate value is helping heavy AI coding users answer:

- Is this long session still healthy?
- Which context looks stale, superseded, duplicated, orphaned, or low-value?
- Which messages are protected and why?
- Is it safe to generate a compressed copy?
- Should I continue this session, produce a handoff, or start fresh?

## Team Review Summary

### Product Lead

- Heavy Claude Code/Codex users would use trimctx for diagnosis and review before trusting it for compression.
- The product should win on local execution, auditability, no original-file mutation, no default LLM calls, and explainable reasons.
- The main competitor is not another JSONL compressor; it is built-in compact/resume behavior and manual handoff summaries.
- Success requires trust before growth: users must believe a zero-deletion result means conservative safety, not failure.

### Software Architect

- Keep the current core pipeline stable: adapter -> normalized messages -> safety -> scoring -> report -> compressor.
- Do not mix platform integrations into core logic.
- Keep `compress_candidate` report-only until validation proves it can safely affect output.
- Treat `score_diagnostics` as observation data for future tuning, not as a behavior change.
- Future integration code should live outside the core engine boundary.

### QA and Security Lead

- Phase 0 safety validation is the gate for future expansion.
- Any critical false deletion blocks release.
- Original transcript hashes must remain unchanged after compression.
- Real transcripts, private reports, and generated validation output must not enter git or npm packages.
- Hooks, install commands, MCP, Web UI, LLM summarization, and automatic compression should remain deferred.

### Developer Experience Lead

- `analyze` is the front door and should stay short, readable, and actionable.
- `report` and `analyze --json` should remain the automation and audit paths.
- Error messages should tell users what was detected, where parsing failed, and what to do next.
- `resume` should be documented as Claude Code focused until broader discovery is proven necessary.

## North Star

Safe useful context reduction:

> Identify useful low-risk cleanup opportunities while maintaining zero critical false deletions and full auditability.

Supporting indicators:

- `critical_false_deletion = 0`
- `protected_recall = 100%`
- every candidate has reasons
- `compress` never mutates the input file
- private samples stay private
- users can understand the next action from `analyze` alone

## Now: v0.2 Stabilization

### N0.1 Complete private validation summary

Goal: turn current private validation runs into a consistent evidence record.

Tasks:

- Keep private raw samples under ignored paths only.
- Update `reports/phase0/validation-summary.md` with aggregate metrics only.
- Record supported format, message count, token count, decisions, top reasons, warnings, and hash preservation.
- Mark OpenAI real-export validation as missing until a real sample exists.
- Do not include sensitive raw message text.

Acceptance:

- At least the existing Claude Code and Codex/Hermes samples are summarized.
- `compress` input hashes are unchanged.
- `score_diagnostics` appears in generated reports.
- The summary clearly distinguishes real private samples from fixtures.

### N0.2 Add manual review rubric

Goal: make future scoring and safety changes measurable instead of subjective.

Tasks:

- Define labels: `safe_remove`, `questionable_remove`, `critical_false_delete`, `missed_low_value_noise`, `over_protected`.
- Require all `remove_candidate` messages to be manually reviewed during Phase 0.
- Sample high-token `compress_candidate` messages for over-protection or missed opportunities.
- Capture before/after metrics after scorer or safety changes.

Acceptance:

- Review rubric exists in docs.
- Phase 0 summary can report precision and false deletion counts.
- Any scorer/safety change has an evidence trail.

### N0.3 Improve CLI trust signals

Goal: make first-run output understandable without reading documentation.

Tasks:

- Ensure `analyze` stays one-screen for large sessions.
- Show next commands for `report` and `compress`.
- Explain that zero `remove_candidate` can be conservative safety behavior.
- Surface warning counts and parser warnings in the human summary.
- Keep `analyze --json` and `report` as complete machine-readable paths.

Acceptance:

- Human summary has targeted tests.
- JSON report remains complete.
- Unsupported or malformed input errors are actionable.

### N0.4 Freeze risky expansion

Goal: keep the project focused until safety evidence is stronger.

Deferred until after v0.2 stabilization:

- Claude Code install command
- slash commands
- hooks and status line
- MCP server
- REST API
- Web UI
- LLM summarization
- automatic compression of active sessions
- lowering default `removeThreshold`
- deleting `compress_candidate`
- exposing user-facing `--weight-*` tuning flags

Acceptance:

- Roadmap and docs consistently state these are later-stage candidates.
- New work during this phase improves trust, reports, tests, validation, or documentation.

## Next: v0.3 Handoff and Integration Design

Start only after v0.2 stabilization.

### N1.1 Design handoff output

Goal: help users continue work safely after a long or noisy session.

Candidate output:

- `handoff.md`
- `next-context.md`
- structured JSON handoff data

The handoff should include:

- current goal
- durable user decisions
- active constraints
- completed work
- remaining tasks
- risky assumptions
- relevant files and commands
- warnings about stale or superseded context

Acceptance:

- The design is documented before implementation.
- Handoff generation does not require an LLM by default.
- Output is clearly separate from destructive compression.

### N1.2 Evaluate current-session discovery

Goal: reduce the need to manually find JSONL files without broad scanning.

Tasks:

- Keep `resume` Claude Code focused.
- Evaluate whether Codex/Hermes discovery has a stable local path.
- Prefer explicit input paths or documented environment variables over broad home-directory scans.
- Keep discovery code outside core parser/scorer/compressor modules.

Acceptance:

- Discovery is opt-in, predictable, and documented.
- It does not scan unrelated sensitive directories.

### N1.3 Prepare Claude Code integration

Goal: plan integration without compromising safety.

Tasks:

- Design install/uninstall behavior.
- Define where generated reports and compressed copies go.
- Use hook-provided `transcript_path` when available.
- Keep hooks fast and non-blocking.
- Default integration command should analyze, not compress.

Acceptance:

- Integration plan exists before code.
- Install/uninstall is idempotent in tests.
- No integration mutates original transcripts.

## Later: Public Release and Enhanced Detection

### L2.1 Open-source release hygiene

Tasks:

- Add or verify CI for test and build.
- Verify `npm pack --dry-run` contents.
- Add sanitized fixtures only.
- Add release checklist, security notes, and contribution guidance.
- Ensure no private transcript or validation output is tracked or packaged.

### L2.2 Heavier detection research

Only consider after the rule-based engine is trusted.

Candidates:

- optional semantic detectors
- local embedding support
- nonsense or hallucination indicators
- richer cross-session analysis

Constraints:

- default path remains local, deterministic, and no-LLM
- optional LLM features must be explicit opt-in
- outputs must remain explainable

## Quality Gates

Run before claiming an iteration is complete:

```bash
npm test
npm run build
git diff --check
```

For release or packaging work also run:

```bash
npm pack --dry-run
```

For scorer, safety, parser, or compressor changes also run private Phase 0 validation when samples are available.

Block completion if any of these happen:

- critical false deletion is found
- protected content is removed
- original input hash changes after `compress`
- private transcripts or private reports appear in tracked files
- `analyze` default output regresses into huge JSON
- docs claim support that real validation has not shown

## Immediate Task Queue

1. Add the manual review rubric and validation summary template improvements.
2. Refresh the private Phase 0 validation summary with current Claude Code and Codex/Hermes evidence.
3. Add targeted tests for human summary trust signals and error messages.
4. Decide whether handoff output should be a new command or a report artifact.
5. Draft the handoff schema before implementation.

## Current Recommendation

The next implementation task should be documentation and validation infrastructure, not scoring-weight changes:

1. Add a review rubric for candidates.
2. Strengthen Phase 0 validation reporting.
3. Then design `handoff.md` / `next-context.md` as the first user-visible expansion after trust is established.
