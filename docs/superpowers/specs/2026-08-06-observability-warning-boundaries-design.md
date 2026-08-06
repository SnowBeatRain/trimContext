# Observability Warning Boundaries Design

## Goal

Keep every existing Report v2 warning while ensuring `assessment.dimensions.observability` counts only warnings that reduce the analyzer's view of the input or the reliability of its measurements.

## Evidence And Root Cause

`createReport()` currently concatenates all warning strings and passes the same array to `createAssessment()`. The array mixes three meanings:

- a compacted-session warning means original conversation detail is no longer fully observable;
- approximate token counts reduce confidence in token-weighted measurements;
- the `compress_candidate` report-only warning explains product behavior but says nothing about input coverage or measurement quality.

Because `observabilityDimension()` treats every supplied warning as medium evidence, the report-only notice raises the dimension score to `0.5`, increments `evidence_count`, and can prevent an otherwise low-risk report from reaching `healthy`.

A UTF-8 structured audit of two Claude and two Codex reports confirmed all observed warnings fall into these three categories. Both Claude reports also have coverage-based medium observability, while the large Codex report has genuine compaction evidence. Excluding only the behavior notice therefore removes false evidence without hiding the real limitations present in those samples.

## Options Considered

1. Keep treating every warning as observability evidence. Rejected because it preserves a known semantic mismatch and makes future informational warnings silently alter health status.
2. Filter the exact report-only warning string before calling `createAssessment()`. This is the smallest edit, but correctness would depend on user-facing copy and would regress when the text changes.
3. Represent warnings as internal structured diagnostics and project them into two views. Selected because it makes the trust boundary explicit while preserving the public string array byte for byte.

## Design

`src/core/diagnostics.ts` will own creation of report warning diagnostics. Each diagnostic contains the existing text and an `affectsObservability` boolean. Compact-session and approximate-token diagnostics set the flag to `true`; the report-only compression notice sets it to `false`.

`createAnalysisWarnings()` remains available with its previous tokenization/candidate-warning scope. A separate `createReportWarningDiagnostics()` composes compact-session diagnostics before those analysis warnings. `createReport()` uses the complete structured diagnostics directly:

- `report.warnings` maps every diagnostic to its text in the existing order;
- `createAssessment()` receives only diagnostic texts whose flag is true.

The existing private compact-warning detector moves from `reporter.ts` into `diagnostics.ts`, so all classifications are made at the warning creation boundary rather than by string inspection later. The assessment parameter is renamed to `observabilityWarnings` to document its narrowed contract; its scoring thresholds and logic do not change.

## Compatibility And Safety

- `trimctx.report.v2` fields, types, warning text, and warning order remain unchanged.
- Compact-session and approximate-token limitations continue to affect observability exactly as before.
- Only the report-only compression notice stops affecting observability.
- Parser behavior, tokenizer selection, safety protection, scorer, thresholds, decisions, candidate arrays, and compression bytes remain unchanged.
- Original transcripts remain read-only.

## Verification

- A failing integration test proves an exact-token report with only a report-only compression notice has low observability with zero observability warning evidence, while retaining the notice in top-level warnings.
- Existing and strengthened tests prove approximate-token and compact-session warnings still count.
- Representative reports are regenerated only under `tmp-real-validation/`; message, protected, candidate, and compression aggregates are compared, and source hashes are checked before and after.
- Final gates are focused vitest, strict script TypeScript, `npm test`, `npm run build`, packed/fresh-install smoke, a 22-file dry-run package, artifact residue scan, and `git diff --check`.
