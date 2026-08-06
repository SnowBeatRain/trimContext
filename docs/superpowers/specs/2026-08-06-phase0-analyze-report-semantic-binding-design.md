# Phase 0 Analyze/Report Semantic Binding Design

## Context

`phase0:run` validates `analyze --json` stdout and the JSON report artifact independently. Both must satisfy the same minimum `trimctx.report.v2` contract and declare the current absolute input path, but a structurally valid analyze report can still disagree with the report artifact while both commands remain successful.

The report artifact is byte-bound into results v2 and independently reopened by `phase0:review`. Analyze stdout is discarded after runner validation, so review cannot currently prove that the historical analyze result represented the same decisions, scores, findings, resume state, or recommendations as the retained report artifact.

A real CLI probe over all six sanitized Claude, OpenAI, and Codex fixtures established the intended contract: after JSON parsing, complete analyze and report objects are equal for every sample, and all source files remain byte-identical. Report v2 has no generated timestamp or other intentionally volatile field. Raw bytes are not equal because analyze uses compact stdout while report uses formatted JSON.

## Goals

- Require every independently valid analyze/report pair to represent the same complete Report v2 JSON value.
- Make a mismatch fail the sample independently of the existing 95% command success-rate thresholds.
- Persist enough private evidence for review to compare historical analyze semantics with the current byte-bound report artifact.
- Let review independently recompute current report semantics instead of trusting a runner-only boolean.
- Preserve privacy: public review JSON/Markdown exposes only counts and fixed issue codes.
- Preserve the Report v2 schema, scorer, thresholds, protected/candidate decisions, compression, six public commands, and original transcript read-only behavior.

## Non-Goals

- Do not compare raw JSON formatting or stdout bytes with report bytes.
- Do not exclude or normalize selected Report v2 fields. Any semantic field difference is a mismatch.
- Do not reopen original transcripts during review.
- Do not introduce signatures or claim resistance to an actor that can rewrite results and artifacts together.
- Do not claim Phase 0 trust is locked or replace manual labels.

## Considered Approaches

### Runner-only deep equality

The runner could parse both objects and mark one command failed when they differ. This gives early feedback, but review cannot recover discarded analyze stdout. A mismatch could also be diluted by the existing 95% command success thresholds unless it has its own readiness gate.

### Raw-byte hashing

The runner could hash analyze stdout and report bytes. This is not semantic comparison: current valid outputs intentionally differ in whitespace, and review cannot reconstruct the historical stdout serialization from the report artifact.

### Canonical semantic digest plus an explicit gate

Adopt this approach. Canonicalize the complete parsed JSON value by recursively sorting object keys while preserving array order and JSON primitive values, then hash the canonical UTF-8 JSON with SHA-256. The runner records an explicit per-sample comparison status and the private analyze digest. Review canonicalizes the current report object and compares it with that digest.

This accepts harmless object-key and formatting differences, rejects every actual JSON-value difference, gives immediate batch evidence, and supports independent current-state review.

## Shared Semantic Fingerprint

Add a script-scoped helper in `scripts/phase0-report-semantics.ts`.

The helper accepts a parsed JSON value and produces a lowercase SHA-256 digest of a deterministic serialization:

- `null`, booleans, strings, and finite JSON numbers retain their JSON values.
- Arrays retain order and recursively canonicalize every element.
- Objects recursively canonicalize values and emit keys in ordinal lexicographic order.
- Unsupported runtime values make fingerprinting unavailable rather than being coerced.

Both inputs have already passed `JSON.parse`, so unsupported values indicate an internal or test-injection boundary problem. The helper never returns the canonical body, field path, or mismatched value through validation output.

## Runner Contract

Extend each `Phase0SampleResult` with:

```ts
analyze_report: {
  status: "matched" | "mismatch" | "unavailable";
  analyze_semantic_sha256?: string;
}
```

The runner keeps analyze and report process/contract results independent:

- If both parsed reports are valid and both fingerprints exist, record the analyze fingerprint and set `matched` or `mismatch` by digest equality.
- If either command is invalid or fingerprinting is unavailable, set `unavailable` and omit the digest.
- `isPhase0SampleOk()` additionally requires `analyze_report.status === "matched"`.
- `aggregate.analyze_report_matched` counts matched samples, and `aggregate.failed_samples` continues to derive from `isPhase0SampleOk()`.

A mismatch does not falsely attribute the defect to one command by changing `analyze.ok` or `report.ok`. It fails through the distinct cross-command gate, while a valid report remains available for compressed-artifact validation and review.

The private results file may contain the analyze semantic digest. The validation summary exposes only the matched count. It must not print the digest, report content, field names from a mismatch, message IDs, paths beyond existing sample output, or JSON parser details.

## Review Evidence

`phase0:review` computes a semantic digest from the same parsed report object whose exact Buffer supplies the existing report byte digest, source, input, and message metrics.

Extend review validation with:

- `expected_analyze_report_pairs`: results whose analyze and report commands are independently successful.
- `matched_analyze_report_semantics`: expected pairs whose batch status is `matched` and whose recorded analyze digest equals the current report semantic digest.

Add fixed readiness issues:

- `analyze_report_semantic_mismatch`: a valid pair was recorded as mismatched or its analyze digest differs from the current report semantics.
- `analyze_report_semantic_validation_unavailable`: required evidence is absent because results were generated before this gate or a fresh pair cannot supply comparison evidence.

Malformed present evidence remains `invalid_phase0_results`. A fresh sample with a failed analyze or report command must explicitly use `unavailable`; it is not included in the expected-pair denominator, and existing execution-rate gates continue to handle that command failure. Missing evidence from an older results v2 file keeps trust `review_required` and requires rerunning `phase0:run`.

The review JSON and Markdown expose only aggregate counts and fixed issues. They never expose semantic digests, canonical JSON, paths, IDs, content, field-level differences, or parser errors.

## Compatibility

- Keep `trimctx.phase0.results.v2` and `trimctx.phase0.review.v2`; fields are additive.
- Older results v2 remains parseable but cannot satisfy readiness without the new evidence.
- Report v2 and public CLI output remain unchanged.
- Existing report byte/source/input gates and compressed set/hash/semantic gates remain independent and ordered before the new readiness conclusion.

## Validation

Unit tests will cover canonical object-key equivalence, array-order sensitivity, nested value drift, invalid runtime values, matched/mismatched/unavailable runner states, aggregate failed-sample behavior, legacy evidence, malformed evidence, current report drift, deterministic issue ordering, and privacy sentinels.

Process tests will create valid analyze/report pairs with one private nested semantic difference and require the sample-level mismatch plus review issue without exposing the changed field or value.

The complete six-fixture Phase 0 chain must produce 6/6 semantic matches with all input hashes unchanged. A controlled results-consistent analyze digest drift must keep report byte/source/input evidence intact while reducing semantic matches to 5/6 with the unique new mismatch issue. Temporary artifacts stay under `tmp-real-validation/` and are removed after verification.

This gate proves cross-command Report v2 correspondence. It does not prove that the shared report semantics are correct or safe, and it does not change the manual-review requirement.
