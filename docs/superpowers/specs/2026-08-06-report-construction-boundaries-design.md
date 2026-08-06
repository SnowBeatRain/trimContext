# Report Construction Boundaries Design

## Goal

Separate report signal construction and human-review construction from report orchestration without changing `trimctx.report.v2`, scorer behavior, safety rules, thresholds, ordering, wording, or compression behavior.

## Evidence

`src/core/reporter.ts` currently combines three responsibilities in one module:

- top-level report orchestration, normalization, parser diagnostics, Phase 0 trust metadata, and warnings;
- candidate-group and finding construction, including aggregation, deduplication, severity, confidence, impact, and sorting;
- review-queue validation plus recommendation construction, including redaction, risk sorting, and command quoting.

The signal and review paths share evidence conversion and confidence ranking, but otherwise have independent inputs, invariants, and tests. Keeping all three responsibilities together makes report-v2 changes harder to review and forces tests to exercise internal behavior only through the full report facade.

## Options Considered

1. Extract only `report-findings.ts` and `report-review.ts`. This reduces file size, but either leaves shared evidence helpers in the orchestration module or duplicates confidence logic.
2. Extract evidence, findings, and review modules. Selected because it gives each unit one responsibility, keeps shared semantics in one place, and leaves a small internal API.
3. Split every helper into finer modules for grouping, sorting, redaction, recommendations, and diagnostics. This creates more module boundaries than the current behavior justifies and would increase migration and verification cost.

## Module Boundaries

### `src/core/report-evidence.ts`

Owns report evidence normalization and confidence ordering:

- `toEvidenceRef()` converts analyzer evidence to the public report evidence shape;
- `confidenceRank()` provides the existing low/medium/high numeric ordering;
- `highestConfidence()` returns the highest value and preserves the existing `medium` fallback for empty input.

The module is pure and depends only on report/analyzer types. It does not group messages or decide review risk.

### `src/core/report-findings.ts`

Owns signal-oriented report construction:

- `createCandidateGroups()` groups supported signal codes by code and related message;
- `createFindings()` aggregates groups by signal code and appends assessment limitations;
- private helpers retain canonical selection, evidence deduplication, severity, token ratio, suggested action, and stable sorting.

The public functions accept already analyzed messages. They do not invoke the scorer, assessment, parser, resume extractor, or report orchestrator.

### `src/core/report-review.ts`

Owns human-review construction:

- `createReviewQueue()` selects reviewable messages, validates every `remove_candidate`, redacts summaries, and applies the existing risk/confidence/token/source ordering;
- `createRecommendations()` constructs the existing health/readiness/remove-count recommendations and quoted commands.

The decisive-code allowlist remains private to this module. It is a report invariant check, not a new scoring or removal rule.

### `src/core/reporter.ts`

Remains the public facade and owns:

- `createReport()` and report assembly;
- normalized-to-analyzed message conversion;
- Phase 0 trust status;
- parser diagnostics;
- compact-boundary and legacy warning detection;
- session metadata extraction.

Existing consumers continue importing only `createReport()` from this module.

## Data Flow

`createReport()` converts normalized messages once, derives summary inputs, then passes the analyzed array to the new constructors. Candidate groups feed findings; assessment limitations also feed findings; assessment status and resume readiness feed recommendations. The returned object is assembled in the same field order with the same arrays and object depth as before.

No new mutation is introduced. Evidence conversion returns new objects, group and finding constructors retain stable sorting, and report construction remains deterministic for the same analyzed messages.

## Compatibility And Safety

- No new command, option, output field, schema version, or package dependency.
- `createReport()` remains the only public report facade used by the pipeline and compressor.
- Candidate groups retain their complete evidence arrays, canonical IDs, token totals, and source-line ordering.
- Findings remain aggregated by signal code, deduplicate equivalent relationships by highest confidence, and sort by severity, confidence, tokens, source line, then code.
- Every `remove_candidate` must remain non-protected, have at least one reason, and carry high-confidence decisive evidence before entering the review queue.
- Review queue summary redaction, 160-character cap, risk ordering, and default actions remain unchanged.
- Recommendation priorities, commands, quoting, and activation conditions remain unchanged.
- No parser, scorer, threshold, assessment, resume, compression, hook, filesystem-write, or transcript behavior changes.

## Testing

- Add direct module tests before each extraction and observe the missing-module RED state.
- Verify evidence conversion, confidence ordering, group construction, finding aggregation, review validation, sorting, redaction, and recommendations through the new APIs.
- Keep full-facade assertions proving `createReport()` returns the same deep structures built by the standalone modules.
- Retain all existing reporter, Markdown, fixture, CLI, hook, packed-install, and package-content regressions.
- Re-run two existing Codex samples and compare message, group, finding, assessment, and Markdown-size outputs with the recorded baselines.
- Run `npm test`, `npm run build`, `npm pack --dry-run --json --silent`, and `git diff --check`.

## Out Of Scope

- Changing report-v2 copy, assessment semantics, signal codes, scorer weights, safety policy, thresholds, or compression.
- Adding compatibility re-exports for internal constructor functions from `reporter.ts`.
- Splitting diagnostics or normalized-message conversion in the same change.
- Introducing a new command or changing the six-command public surface.
