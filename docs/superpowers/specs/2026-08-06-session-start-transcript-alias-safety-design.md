# SessionStart Transcript Alias Safety Design

## Goal

Keep the original Claude transcript read-only even when `CLAUDE_ENV_FILE` is
misconfigured to the transcript path or to a filesystem alias of it, while
preserving SessionStart's append-only binding format and optional-session-ID
reset behavior.

## Confirmed Failure

A real CLI probe set `CLAUDE_ENV_FILE` to the same path supplied as
`transcript_path`, then ran `trimctx hook --session-start`. The process exited
zero, reported a successful update, changed the transcript SHA-256, and
appended both shell exports to the JSONL file.

The root cause is direct `appendFile(envFile, ...)` after input validation.
SessionStart validates field types but never compares the env target with the
source transcript. This violates the documented contract that original JSONL
transcripts remain read-only.

## Approaches Considered

1. Open-handle identity validation followed by append through the same verified
   env handle. This is selected because it detects direct paths and existing
   symlink/hardlink aliases without reopening the output after validation.
2. Call `assertDifferentFiles()` and keep `appendFile()`. This is smaller, but
   validation and append open the target separately, leaving a larger
   check/use window than the project's existing handle-based safety patterns.
3. Read and atomically replace the env file. This would conflict with Claude's
   append-oriented env-file contract and could discard bindings written by
   other hooks.

## Architecture

Add `appendFileDistinctFromInput()` to `src/platform/files.ts`:

```ts
appendFileDistinctFromInput(
  inputFile: string,
  outputFile: string,
  data: string,
  conflictMessage?: string
): Promise<void>
```

The operation performs these steps:

1. Reject identical resolved paths before opening or creating the output. On
   Windows, compare resolved paths case-insensitively.
2. Open the env output with `O_WRONLY | O_CREAT | O_APPEND`.
3. Open the transcript read-only. `ENOENT` means no current input inode and
   preserves the existing ability to bind a not-yet-created transcript path;
   every other open failure propagates.
4. If the transcript exists, compare `dev` and `ino` from the two open handles.
   A match rejects before any append, covering symlink, hardlink, junction, and
   case/path aliases resolved by the operating system.
5. Append the complete two-line binding through the already verified output
   handle.
6. Close every opened handle with all-settled semantics. Preserve a lone
   operation or close error identity, and aggregate an operation failure with
   every close failure in deterministic output-then-input order.

`writeSessionEnvBinding()` keeps stdin validation, `CLAUDE_ENV_FILE`
requirement, parent `mkdir`, shell quoting, and complete two-variable snapshot
format. It replaces only direct `appendFile()` with the shared safe append
operation and supplies the stable error:

```text
Claude session env file must be different from transcript
```

Stop hook `CLAUDE.md` storage remains independent.

## Safety Semantics

- Same resolved path: reject before output creation or append.
- Existing symlink or hardlink alias: reject after handle identity comparison;
  both names retain the original transcript bytes.
- Distinct existing env file: append without truncating prior content.
- Missing distinct env file: create and append as before.
- Missing transcript at SessionStart: append the binding as before.
- Transcript open failure other than `ENOENT`: fail closed without appending.
- Conflict errors do not include transcript content, env content, hashes, or
  session IDs.

The standard cross-platform Node filesystem API cannot make an arbitrary inode
comparison and later append one indivisible operation. The design minimizes
the interval by writing through the verified open output handle, but it does
not claim a fully linearizable defense against a hostile actor changing the
transcript namespace after the comparison.

## Test Strategy

- Real-filesystem platform tests cover direct same path, hardlink alias,
  distinct existing env append, missing env creation, and missing transcript.
- A mocked failure test injects an operation error plus output/input close
  errors and verifies deterministic aggregation without writing repository-root
  fixture files.
- Real-process SessionStart regressions cover the exact same path and a hardlink
  alias, require nonzero exit and stable diagnostics, and hash every transcript
  before and after.
- Existing repeated SessionStart coverage continues to prove complete
  transcript/session snapshots and empty-ID reset behavior.
- Run targeted tests, the full suite, strict TypeScript, build,
  packed/fresh-install smoke, package dry-run, `git diff --check`, and the
  post-fix same-path CLI probe.

## Documentation

Update the changelog, current status, and English/Chinese hook write-scope
paragraphs to state that SessionStart rejects a `CLAUDE_ENV_FILE` that aliases
the transcript. Correct older status text that says SessionStart persistence
was unchanged or that transcript read-only behavior was already unconditional.

## Non-Goals

- No env-file replacement, parsing, compaction, or deduplication.
- No change to shell quoting or the two-export snapshot.
- No requirement that a missing transcript already exist at SessionStart.
- No changes to Stop, analysis, scoring, thresholds, reports, compression,
  session discovery, or the six public commands.
