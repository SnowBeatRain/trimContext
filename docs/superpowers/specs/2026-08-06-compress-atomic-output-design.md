# Compress Atomic Output Design

## Problem

`compressFile()` reads and analyzes the input through an open handle, but writes the compressed copy through `writeFileDistinctFromInput()`. That writer opens an existing output without `O_TRUNC`, validates inode identity, then truncates and writes it in place.

Consequences:

- a write failure after truncate destroys the previous compressed copy;
- input identity is checked only after analysis, so an input modified during preparation becomes the accepted baseline and an output derived from the earlier bytes can still be committed;
- this contradicts the current Unreleased contract that transcript-derived writes reuse a pre-read input snapshot and atomic replacement.

The original transcript remains protected from output aliasing, but the derived-output and consistency guarantees lag behind report/export.

## Decision

Keep the existing early `assertDifferentFiles()` check and compression transformation. After opening the input handle:

1. capture `inputHandle.stat()` before reading;
2. read, parse, score, and format the compressed output exactly as today;
3. call `atomicWriteFileDistinctFromInput()` with the captured snapshot.

The helper validates the snapshot before staging, stages in the output directory, validates the open input and output identity again immediately before commit, then atomically replaces the target. Existing Windows backup/restore and cleanup semantics apply unchanged.

## Compatibility

Candidate selection, protected rules, scorer thresholds, JSONL transformation, output path, stdout summary, and successful output bytes remain unchanged. The original transcript stays read-only. Existing compressed output now survives preparation, stage-write, identity-check, and commit failures when recovery succeeds.

## Verification

- Inject a stage write failure after an existing output is present; require the old output and input to remain byte-identical and temp cleanup to complete.
- Mutate the input after the atomic stage is opened but before commit; require snapshot rejection and preservation of the old output.
- Run compressor, file safety, CLI compression, Phase 0, and complete quality gates.
