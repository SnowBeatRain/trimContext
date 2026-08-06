# Phase 0 Compressed Semantic Validation Design

## Background

Phase 0 now binds every successful `.trimmed.jsonl` artifact to exact bytes through SHA-256 and requires the current artifact set and hashes to match batch evidence. That detects missing, stale, unreadable, or replaced files, but it does not prove that the bound bytes are valid JSONL or that the normalized messages agree with the decisions in the bound Report v2 artifact.

A successful `compress` subprocess can therefore still be counted as successful when it writes malformed JSONL, keeps a `remove_candidate`, removes a kept message, or rewrites a recognized message. Hash matching only proves that review reopened the same incorrect bytes.

## Goals

- Require a successful Phase 0 compressed artifact with a valid report reference to be structurally re-readable by the adapter for the report's declared source.
- Compare the normalized compressed messages with the report's expected retained-message multiset.
- Recompute the same structural and semantic result during `phase0:review` instead of trusting only a historical command result.
- Preserve supported metadata and parser-ignored records without treating them as messages or corruption.
- Expose aggregate counts and fixed issue codes only; do not expose content, fingerprints, message IDs, paths, digests, or parser errors.
- Keep the compressor, parser behavior, scorer, thresholds, protected rules, decisions, Report v2 schema, results/review schema versions, and six-command public surface unchanged.

## Non-goals

- Do not change which messages the product compressor removes.
- Do not require byte-for-byte equivalence for retained rows; OpenAI batch rows are intentionally rewritten.
- Do not compare IDs or source lines, which are unstable after line and array-element removal.
- Do not require Codex runtime metadata, encrypted reasoning, unknown response items, or OpenAI batch entries ignored by the parser to become normalized messages.
- Do not reopen original transcripts during review.
- Do not claim that a passing artifact is safe without manual review or that Phase 0 trust is locked.
- Do not add a signature or protect against an actor who can coherently rewrite all evidence and artifacts.

## Approaches Considered

### Validate only during `phase0:run`

The runner could reject malformed or inconsistent output immediately, and existing report/output hashes would bind that result. This gives early feedback but makes review depend on a historical validation claim and does not independently demonstrate the current artifact's structure and semantics.

### Validate only during `phase0:review`

Review could independently reopen the bound report and compressed artifact and enforce the final gate without changing per-sample execution semantics. This is sufficient for trust readiness but delays a deterministic artifact defect until after the complete batch.

### Use one shared validator in runner and review

Adopt this approach. A script-scoped pure validator owns source-specific re-parsing, report-message identity validation, multiset construction, and comparison. The runner applies it after reading a successful compressed artifact when the report artifact is valid. Review independently applies it to the current report and compressed bytes before constructing aggregate evidence.

This provides early failure and current-state audit evidence while keeping one semantic definition. If the report command itself is invalid, the runner preserves compression's independent file/hash result because the batch is already failed and no valid report decision set exists; review classifies semantic validation as unavailable and cannot become ready.

## Stable Message Identity

IDs and source positions cannot be used:

- Codex IDs fall back to `<file>:<sourceLine>`, and line removal renumbers later messages.
- OpenAI batch IDs include the array index, and removing an earlier entry renumbers later entries.
- Claude duplicate streaming frames can be deduplicated or replaced during parsing.

The validator therefore builds an internal fingerprint from the normalized tuple:

```text
source + role + content + timestamp-or-null + sessionId-or-null
```

It compares a multiset, not a set, so repeated identical messages retain their counts. The fingerprint remains process-local and is never returned by review output. Tool-use and tool-result linkage remains represented in normalized content by existing adapters; Report v2 does not expose the full `tool` object, so no new identity field is invented.

## Expected And Actual Sets

The expected multiset comes from `report.messages`:

- exclude every message whose decision is `remove_candidate`;
- retain `keep`, `keep_protected`, and `compress_candidate`;
- require every referenced report message to have a supported role, string content, the report source, a valid decision, and optional string timestamp/session ID.

The actual multiset comes from parsing the entire compressed content with the adapter selected by `report.input.source`:

- Claude Code uses `parseClaudeCodeJsonl`;
- OpenAI uses `parseOpenAiJsonl`;
- Codex uses `parseCodexJsonl`.

All three adapters parse every non-empty row as JSON through the existing diagnostics layer, so malformed JSONL fails structurally. Source-specific legal records that intentionally produce no normalized message remain permitted. Empty output is structurally valid and matches only an empty expected retained-message multiset.

## Shared Validation Result

The shared validator returns one fixed status plus private aggregate counts:

```ts
type Phase0CompressedValidationStatus =
  | "matched"
  | "invalid_structure"
  | "message_set_mismatch"
  | "reference_unavailable";

interface Phase0CompressedValidation {
  status: Phase0CompressedValidationStatus;
  expected_messages: number;
  parsed_messages: number;
}
```

It catches adapter errors and does not return parser messages. `reference_unavailable` covers an unsupported source or a report message that cannot form a valid comparison identity.

## Runner Behavior

After a successful compress subprocess, the runner keeps the existing regular-file and exact-byte read checks. When the report artifact passed its existing minimum Report v2 and input-identity checks, the runner invokes the shared validator on the same Buffer used for SHA-256:

- `invalid_structure`: convert `compress.ok` to false with a fixed invalid-JSONL artifact error;
- `message_set_mismatch`: convert `compress.ok` to false with a fixed report-decision mismatch error;
- `reference_unavailable`: convert `compress.ok` to false with a fixed report-reference validation error;
- `matched`: retain success and record `output_sha256` as before.

Failed semantic validation omits `output_sha256`, matching the existing rule that only successful validated compressed artifacts receive a digest. The error may identify the private target in private `phase0-results.json`, but it never includes content, parser output, a fingerprint, an ID, or the mismatched value.

If no valid report artifact is available, the runner does not pretend to compare against analyze output or a partial report. It retains the existing compressed file/hash validation result; the already-failed report keeps the sample failed, and review cannot satisfy semantic readiness without the report reference.

## Review Behavior

Review reads each usable `.trimmed.jsonl` as a Buffer, computes its SHA-256, and validates it against the same-name loaded report using the shared validator. The in-memory compressed artifact evidence becomes:

```ts
interface Phase0CompressedArtifact {
  sha256: string;
  validation: Phase0CompressedValidation;
}
```

`ValidationEvidence` adds:

```ts
structurally_valid_compressed_artifacts: number;
matched_compressed_message_sets: number;
```

Both use `expected_compressed_artifacts` as their denominator. Existing set and hash counts stay independent.

Readiness issue codes are deterministic:

- `compressed_structure_invalid` when an expected current artifact cannot be parsed by its source adapter;
- `compressed_message_set_mismatch` when parsing succeeds but the normalized multiset differs;
- `compressed_validation_unavailable` when a usable report reference cannot form the comparison.

Missing or unreadable files remain `compressed_set_mismatch`; missing historical hashes remain `compressed_integrity_unavailable`; byte drift remains `compressed_hash_mismatch`. Independent defects may produce more than one fixed issue.

## Privacy And Error Boundaries

- `phase0-results.json` remains private and may contain only the existing fixed runner error with its target path.
- Review JSON and Markdown expose only counts and fixed issue codes.
- Adapter exception text, content, report values, fingerprints, IDs, source lines, paths, and hashes never enter review artifacts.
- Review does not retain compressed Buffers after producing the per-artifact hash and fixed validation result.
- Semantic fingerprints are comparison internals and are not persisted.

## Compatibility

- `trimctx.phase0.results.v2` and `trimctx.phase0.review.v2` remain unchanged because only additive nested result behavior and additive aggregate review fields are introduced.
- Older results v2 can be reviewed: the current report and compressed bytes are revalidated directly. Existing missing-digest compatibility remains unchanged.
- Existing reports with malformed gate-relevant message identity cannot become ready; no full Report v2 schema validator is claimed.
- The public `compress` command output and bytes do not change.

## Test Strategy

- Shared validator: accept real compressed copies for Claude, OpenAI, and Codex fixtures; cover OpenAI array reindexing, Codex ignored metadata, duplicate counts, empty output, malformed JSONL, report-reference invalidity, and valid-JSON semantic drift.
- Runner: verify malformed output and semantic drift turn a zero-exit compress process into fixed failure without a digest or content leak; verify a matching artifact retains the exact digest.
- Evidence: verify each fixed validation status changes only the new aggregate counts and issue code while existing set/hash counts remain matched.
- Review: verify malformed JSONL and valid-JSON message drift remain `review_required` even when results contain the matching current digest; verify JSON/Markdown contain only aggregate counts and fixed issues.
- Regression: run focused Phase 0 tests, strict script type-checking, the full suite, build, package/fresh-install smoke, npm dry-run inspection, sanitized real Phase 0 run/review, and `git diff --check`.

## Success Criteria

- A structurally invalid compressed artifact cannot satisfy Phase 0 readiness.
- A compressed artifact that keeps a remove candidate, drops a retained message, adds a recognized message, or changes a recognized message cannot satisfy Phase 0 readiness.
- Line-number and OpenAI index changes do not create false mismatches.
- Parser-ignored but valid metadata remains permitted.
- Runner and review use one comparison definition.
- Review output remains aggregate-only and privacy-narrowed.
- No scorer, threshold, protected, decision, compression, Report v2, public command, or original-transcript behavior changes.
