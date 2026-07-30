# Refactor Architecture Notes

This document records the post-refactor module boundaries for maintainers. It is intentionally outside the npm `files` allow-list, so it guides development without changing the published package surface.

## Pipeline

The local analysis pipeline stays synchronous and offline:

1. `src/core/analyzer.ts` detects the JSONL source format and normalizes records through one adapter.
2. Token estimation is applied before safety and scoring.
3. `src/core/safety.ts` attaches hard-protection reasons.
4. `src/core/scorer.ts` converts ROT metrics into decisions.
5. `src/core/reporter.ts` builds the public `AnalysisReport` object.

The command layer should call these core functions instead of duplicating parsing, scoring, or report construction logic.

## Adapter boundary

Adapters normalize source-specific records into `NormalizedMessage` and should avoid policy decisions.

- `src/adapters/content.ts` owns generic content flattening.
- `src/adapters/codex-jsonl.ts` owns Codex record routing.
- `src/adapters/codex-tool-items.ts` owns Codex tool-use/tool-result normalization.

Keep source-specific fallbacks local to the adapter module so future transcript formats can be added without touching scoring or reporting.

## Reason and scoring boundary

Scoring is split into two layers:

- `src/core/rot-metrics.ts` computes deterministic ROT metric numbers.
- `src/core/scorer.ts` maps those metric numbers to audit reasons and decisions.

This keeps threshold tuning and reason-label behavior auditable without mixing it with text-feature extraction.

## Reporter boundary

Reporting is split into:

- `src/core/reporter.ts` for assembling the `AnalysisReport` structure.
- `src/core/report-summary.ts` for summary totals, tokenization metadata, pressure, warnings, and candidate counts.

Do not duplicate summary math in command output; CLI formatters should consume the report shape.

## Command boundary

`src/commands/index.ts` registers command modules only. Command implementations live in separate files and should remain thin orchestration layers around core APIs.

## Quality gates

For behavior-preserving refactors, run at minimum:

```bash
npm run build
npm test
git diff --check
```

When changing package or integration files, also run:

```bash
npm run build:publish
npx vitest run tests/package-contents.test.ts
```

Slow compression/scoring tests may exceed Vitest's 5s default when invoked directly; use the repository `npm test` script or pass `--testTimeout=30000`.
