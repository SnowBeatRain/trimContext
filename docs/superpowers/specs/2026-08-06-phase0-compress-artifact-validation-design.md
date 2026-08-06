# Phase 0 Compress Artifact Validation Design

## Problem

Phase 0 now validates analyze JSON and report JSON artifacts, but `compress_ok` still mirrors only the child-process exit status. A compress process that exits zero without creating `<sample>.trimmed.jsonl`, creates a directory at that path, or leaves an unreadable target is counted as successful and can satisfy the 95% execution gate.

The injected sample tests currently return compress success without producing an artifact, confirming that the output contract is absent from both implementation and tests.

## Decision

Validate a successful compress process independently after all three commands and the input after-hash:

- nonzero process result: preserve it and do not inspect a potentially stale artifact;
- `ENOENT`: `Compressed artifact was not created: <path>`;
- non-regular target: `Compressed artifact target is not a regular file: <path>`;
- other stat failures: `Compressed artifact could not be inspected: <path>`;
- open or close failure while checking readability: `Compressed artifact could not be read: <path>`.

Contract failures retain the real process exit code but set `ok=false`. They reduce `compress_ok`, place the sample in `failed_samples`, and do not abort final evidence. The validator opens the file without loading or echoing its contents. An empty regular readable file is not rejected because the current compression contract does not prohibit a valid empty result.

## Compatibility

The results schema, output paths, command order, input hashing, summary metadata selection, Phase 0 thresholds, scorer, compression decisions, CLI surface, and transcript read-only behavior remain unchanged.

## Verification

- A real-process test deletes the compressed artifact after successful creation and requires final evidence with `compress.ok=false` and `exit_code=0`.
- Injected-runner tests cover missing/non-regular artifacts and prove a failed compress process is preserved without stale-artifact inspection.
- Existing injected success runners create a real compressed file.
- Run focused Phase 0 tests, strict script type-checking, and complete quality gates.
