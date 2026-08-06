# Report Signal Quality Design

## Goal

Make Report v2 health status and key findings accurate and usable on long Codex sessions without changing parser behavior, safety protection, scoring weights, thresholds, decisions, review queues, candidate groups, or compression.

## Evidence

A read-only aggregate review of 12 recent local Codex sessions found:

- 9 sessions reported `unknown`; several had `remove_candidate` messages and high-confidence findings.
- A 575-message, 944,500-token session had 98.43% analyzable coverage, four remove candidates, multiple high-confidence supersession signals, and `context_pressure: high`, but `protected_coverage_too_high` forced the overall status to `unknown`.
- A 1,468-message session produced 96 signal findings, including 73 marked `critical`, because every candidate group became a finding and confidence was used as severity.
- The corresponding Markdown report was 506,461 bytes with 96 level-three finding headings.

The root causes are in the report layer:

1. `createAssessment()` returns `unknown` before evaluating established negative evidence.
2. `createFindings()` creates one finding per candidate group.
3. Finding severity is derived from evidence confidence rather than the decision risk of affected messages.
4. Markdown renders every evidence reference for every finding.

## Options Considered

1. Change only assessment precedence. This fixes misleading status but leaves unusable findings.
2. Cap only Markdown output. This hides the symptom while JSON still claims dozens of critical key findings.
3. Correct Report v2 semantics while preserving detailed audit structures. Selected because `candidate_groups`, `review_queue`, and `messages` already retain full detail.

## Assessment Semantics

Established negative evidence is actionable even when coverage has limitations. Status precedence becomes:

1. `degraded` when high context pressure, multiple high-confidence risk signals, or high stale-token ratio is already established.
2. `attention` when medium risk dimensions or protected high-rot evidence is established.
3. `unknown` when limitations prevent a positive health conclusion and no established negative status exists.
4. `healthy` only when all existing positive-evidence gates pass.

Limitations remain attached to degraded or attention assessments. A degraded result with limitations uses medium confidence; without limitations it remains high confidence. No limitation can turn a risky session into healthy.
Observability alone is not a negative-risk dimension: medium observability without stale, repetition, tool, pressure, continuation, or protected high-rot risk remains `unknown` rather than `attention`.

## Finding Semantics

`candidate_groups` remains the complete per-relation audit structure. `findings` becomes a key-finding layer with at most one signal finding per stable signal code plus limitation findings.

For each signal code:

- member message IDs and evidence are deduplicated deterministically;
- token impact counts each member message once;
- confidence remains the highest evidence confidence;
- severity is `critical` only when at least one member is a `remove_candidate`, `warning` when a member is a `compress_candidate` or protected high-rot review item, otherwise `info`;
- findings sort by severity, confidence, token impact, earliest evidence line, then code.

The Markdown report displays at most five evidence references per finding and records the omitted count. Full evidence remains available in JSON findings and candidate groups.

Markdown review tables partition the unchanged JSON review queue: unprotected candidates appear under the general review queue, while protected high-rot items appear under the dedicated protected section. This keeps every review item visible once instead of duplicating large protected subsets.

## Compatibility And Safety

- `trimctx.report.v2` field names and types remain unchanged.
- `candidate_groups`, `review_queue`, `messages`, remove/compress candidate arrays, reasons, and evidence remain available.
- Parser, tokenizer, safety, scorer, thresholds, protected decisions, and compression output are unchanged.
- Report JSON values intentionally improve: status precedence, finding aggregation, IDs, impact, ordering, and severity.
- Original transcripts remain read-only.

## Verification

- RED/GREEN tests cover risk precedence under limitations, low-risk unknown behavior, finding aggregation, unique token accounting, risk-based severity, stable ordering, and Markdown evidence bounds.
- Existing assessment, reporter, Markdown, CLI, compressor, parser, hook, and packed-install tests remain green.
- The same representative Codex sessions are re-analyzed using aggregate-only output; no message body is printed.
- Final gates are `npm test`, `npm run build`, `npm pack --dry-run --json`, and `git diff --check`.
