# SessionStart Input Preflight Safety Design

## Problem

`appendFileDistinctFromInput()` currently opens the append target with
`O_CREAT` before it attempts to open the transcript. A SessionStart payload
whose `transcript_path` is a string but cannot be passed to the operating
system, such as a path containing a NUL byte, therefore fails with a nonzero
exit but leaves a new zero-byte `CLAUDE_ENV_FILE` behind.

This is an ordering defect in the storage boundary. Hook input validation
correctly establishes the JSON field type, but it cannot replace the actual
filesystem open that classifies the path as missing, readable, inaccessible,
or invalid.

## Goals

- Do not create or modify the env target when transcript inspection fails for
  any reason other than `ENOENT`.
- Continue allowing SessionStart to write a binding before Claude creates the
  transcript.
- Preserve same-path and existing symlink/hardlink rejection.
- Preserve `O_APPEND`, the two-export snapshot, deterministic close-error
  aggregation, and the stable SessionStart conflict error.

## Non-Goals

- Do not add a platform-specific path validator or reject valid unusual paths.
- Do not require the transcript to exist.
- Do not delete or roll back env files after an output operation starts.
- Do not change Stop, parsing, scoring, thresholds, reports, or compression.

## Design

Keep the resolved-path precheck first. Then call `openFileIfExists(inputFile,
"r")` before opening `outputFile`. `openFileIfExists()` continues to interpret
only `ENOENT` as an absent future transcript; invalid paths, permission errors,
I/O errors, and directory-open failures reject before `O_CREAT` can run.

After input preflight, open the env target once with
`O_WRONLY | O_CREAT | O_APPEND`. If the input handle exists, compare the two
opened handles by `dev/ino`. Append only through that verified output handle.
Close every handle that was opened and retain the current operation-first,
output-close, input-close error ordering.

Deleting a newly observed empty output after failure is intentionally avoided:
the implementation cannot safely distinguish its own new file from a
pre-existing empty file or concurrent append target. Rejecting before output
open is the only rollback-free boundary.

## Tests

- A real-filesystem platform regression passes a NUL-containing input path and
  asserts that the missing output remains absent.
- A real SessionStart process regression asserts nonzero exit, no success
  message, and no `CLAUDE_ENV_FILE` creation for the same invalid path.
- Existing missing-transcript, ordinary append, direct alias, hardlink alias,
  and aggregate close-error tests remain green.
- A real probe repeats the original failing case after the fix.

## Residual Boundary

The helper does not provide a cross-process lock or a linearizable relationship
between two directory paths. It does ensure that the exact input handle was
successfully classified before any output handle is opened, and that the exact
output handle used for append was checked against that input handle.
