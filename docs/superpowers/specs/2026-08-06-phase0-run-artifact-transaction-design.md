# Phase 0 Run Artifact Transaction Design

## Problem

`phase0-run.ts` writes `phase0-results.json` and `validation-summary.md` with two sequential `writeFile()` calls. If the second write fails, the first target has already been replaced, so an older coherent evidence pair becomes a mixed or incomplete snapshot. The review artifact pair already has backup-based in-process transaction semantics, but its implementation is coupled to review filenames and messages.

## Decision

Extract the proven staging, commit, rollback, backup cleanup, and stage cleanup implementation into a script-scoped generic Phase 0 artifact-pair writer. Keep narrow wrappers for the two callers:

- `writePhase0ReviewArtifacts(outDir, json, markdown)` targets `phase0-review.json` and `phase0-review.md`.
- `writePhase0RunArtifacts(outDir, json, markdown)` targets `phase0-results.json` and `validation-summary.md`.

The generic writer accepts exactly two named UTF-8 text artifacts plus a privacy-safe operation label used in diagnostics. It does not become a public CLI or shared production filesystem API.

## Transaction Semantics

1. Write both complete bodies to exclusive same-directory stage files before inspecting or changing either target.
2. Require each existing target to be a regular file; only `ENOENT` means absent.
3. Commit in caller order through backup plus rename for existing targets, or direct stage rename for new targets.
4. If a later commit fails, roll back already committed targets in reverse order. Restore old files and remove targets newly created by this transaction.
5. Flatten operation and rollback failures into one `AggregateError` while retaining any backup that could not be restored.
6. Attempt every backup and stage cleanup. Report all cleanup failures and retain artifacts that could not be removed.

Successful commit followed by backup cleanup failure returns an error while leaving the newly committed pair consistent and the failed backup available for recovery. Forced termination, power loss, operating-system failure, and concurrent writers remain outside the guarantee because there is no persistent journal or lock.

## Compatibility

The change does not alter:

- `trimctx.phase0.results.v1` or `trimctx.phase0.review.v2` fields and content.
- stdout or successful Markdown text.
- per-sample report and trimmed artifact behavior.
- Phase 0 gates, scorer, threshold, safety, decisions, or compression.
- the six-command public CLI or original-transcript read-only contract.

## Verification

- Add a real-process regression where an existing results file and an invalid summary target cause `phase0:run` to fail while preserving the old results file and leaving no stage/backup residue.
- Keep existing review transaction fault-injection tests green after extraction.
- Run focused Phase 0 tests, the complete test suite, TypeScript build, packed/fresh-install smoke, package dry-run, `git diff --check`, and residual artifact checks.
