# Phase 0 Run Result Validation Design

## Problem

`phase0-run.ts` currently treats a zero process exit as a successful analyze/report result before validating the associated JSON contract. It parses only one metadata source after all three commands:

- A successful report command with a missing artifact remains `report.ok = true` and is counted in `report_ok`.
- Invalid report JSON throws outside `runCli()`, aborting the entire batch before final evidence is written.
- Analyze JSON is not parsed at all when a report artifact exists, so invalid `analyze --json` output can remain `analyze.ok = true`.
- The report existence helper converts every `stat()` error into “missing,” hiding permission and I/O failures.

These behaviors weaken Phase 0 evidence: command process health and command output-contract health are conflated.

## Decision

Extract per-sample execution and validation into `scripts/phase0-run-sample.ts`. The module runs analyze, report, and compress in the existing order, hashes the input before and after, validates analyze JSON independently, validates a successful report command's artifact, and returns the existing result shape.

`ok` represents the complete audited command contract. When a process exits zero but its required JSON/output artifact is missing, non-regular, unreadable, or invalid, the stored command result becomes:

```json
{
  "ok": false,
  "exit_code": 0,
  "error": "<stable privacy-safe contract error>"
}
```

The actual process exit code remains unchanged instead of being fabricated as `1`. Phase 0 gates already use `ok`, so contract failures reduce `analyze_ok` or `report_ok` and place the sample in `failed_samples` without changing the results schema.

## JSON And Artifact Validation

Analyze validation:

- Exit nonzero: preserve the existing command failure and do not parse stdout.
- Exit zero with absent/blank stdout: mark `ok=false` with `Analyze command returned no JSON report`.
- Exit zero with malformed JSON or a non-object top level: mark `ok=false` with `Analyze command returned invalid JSON report`.

Report validation:

- Exit nonzero: preserve the existing command failure and do not inspect a possibly stale artifact.
- `ENOENT`: mark `ok=false` with `Report artifact was not created: <path>`.
- Non-regular target: mark `ok=false` with `Report artifact target is not a regular file: <path>`.
- Other stat/read failures: mark `ok=false` with a stable inspect/read error containing only the target path.
- Malformed JSON or a non-object top level: mark `ok=false` with `Report artifact contains invalid JSON: <path>`.

No error includes stdout, report content, parser fragments, or stack traces. `phase0-results.json` remains private because it still includes local paths and command stderr/error fields.

## Metadata Selection

Parse analyze and report independently. Use a valid report object for `summary`, `source`, and `warnings`; if the report contract fails, use a valid analyze object. If neither is valid, omit those optional fields. A metadata fallback never changes the failed command's `ok` value.

## Structure

- `phase0-run-sample.ts`: command runner, input hashing, command-contract validation, result compaction, and `isPhase0SampleOk()`.
- `phase0-run.ts`: argument parsing, batch planning/orchestration, aggregate construction, final artifact formatting and transaction.

The command runner is injectable for focused tests, while default execution still invokes `node --import tsx src/cli.ts` with the same timeout and buffer.

## Compatibility

The change does not alter successful command output, execution order, timeout, buffer limit, result schema, Phase 0 thresholds, report/trimmed filenames, scorer, safety, decision, compression, public CLI surface, or original-transcript read-only behavior.

## Verification

- Real-process tests tamper with or remove a successfully written report while compress is still running, proving the batch completes with `report.ok=false`, valid analyze fallback metadata, unchanged input hash, and final evidence.
- An injected-runner test proves invalid analyze JSON is detected even when the report artifact is valid.
- Focused Phase 0 tests, strict script TypeScript checking, the complete suite, build, packed/fresh-install smoke, 22-file package dry-run, diff check, and residual artifact scan must pass.
