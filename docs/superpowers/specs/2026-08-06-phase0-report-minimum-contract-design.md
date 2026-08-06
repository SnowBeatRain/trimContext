# Phase 0 Report Minimum Contract Design

## Problem

Phase 0 independently parses analyze stdout and report artifacts, but accepts every non-array JSON object. `{}`, a wrong schema version, an unsupported source, or missing summary diagnostics can therefore remain `analyze.ok=true` / `report.ok=true` and inflate the batch aggregate. The later review evidence loader prevents trust from locking when source metadata is absent, but `phase0-results.json` itself is misleading and the failure is detected too late.

## Decision

Add one shared minimum `trimctx.report.v2` shape guard for both analyze and report parsing. It validates the fields consumed by Phase 0 aggregation and downstream evidence:

- `schema_version === "trimctx.report.v2"`;
- `input.file` is a string and `input.source` is a supported normalized source;
- `summary` contains non-negative integer totals for messages, tokens, remove candidates, compress candidates, and protected messages;
- `summary.score_diagnostics` contains non-negative integer near-threshold/protected-high-ROT counts and a finite non-negative max ROT score;
- `messages`, `remove_candidates`, `compress_candidates`, and `warnings` are arrays, with every warning a string.

This is deliberately narrower than full Report v2 validation. Message-level gate fields remain owned by `phase0:review` and its report-quality checks.

Error classification:

- malformed JSON or non-object top level keeps the existing invalid-JSON error;
- a parsed object that fails the minimum shape uses a fixed `invalid trimctx.report.v2 contract` error;
- no invalid field value, parser fragment, or content is included.

## Compatibility

Valid CLI output, metadata selection, result schema, thresholds, command order, scorer, compression, and public commands remain unchanged. Only structurally unusable objects stop counting as successful Phase 0 analyze/report results.

## Verification

- Inject wrong-schema objects with private sentinel values into analyze stdout and report artifacts.
- Require both command results to become `ok=false` with exit code zero and privacy-safe contract errors.
- Convert all valid injected fixtures to one shared minimum Report v2 builder.
- Run real Phase 0 processes, evidence/review gates, strict script checking, and complete quality gates.
