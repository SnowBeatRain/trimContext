# File Inspection Error Classification Design

## Problem

`src/platform/files.ts` still has two broad filesystem-error fallbacks:

- `sameFile()` catches every `stat()` failure and returns `false`, so permission and I/O failures are misreported as proof that two paths are different.
- The Windows atomic replacement fallback catches every target `stat()` failure as "not a regular file." When the original rename and the inspection both fail, only the rename error survives.

Both paths sit in shared write-safety code. Treating an unknown identity or target type as a negative fact weakens fail-closed diagnostics, even though later handle-based checks still protect current transcript writes.

## Decision

Introduce one internal `statIfExists()` helper. It returns `undefined` only for `ENOENT` and propagates every other error.

`sameFile()` resolves both stats through that helper. If either path is genuinely absent, it returns `false`; if either inspection fails for another reason, it rejects instead of claiming the files differ.

During Windows replacement, keep the original rename error. If inspecting the existing target also fails, throw an `AggregateError` containing both ordered leaf causes. If the target is absent or not a regular file, preserve the existing rename error and do not enter the backup/replace path.

## Compatibility

Successful identity checks, missing-path behavior, symlink/hard-link detection, atomic replacement, output bytes, command output, and public APIs remain unchanged. This only changes failure reporting for permission and I/O errors that were previously downgraded or hidden.

## Verification

- Inject `EACCES` into `sameFile()` target inspection and assert the same error object is propagated.
- On Windows, inject an `EPERM` commit rename plus `EACCES` target inspection and assert both causes are retained, the old target is unchanged, and the owned temp file is cleaned.
- Run focused platform/CLI write tests, the full suite, build, package dry-run, diff check, and residual artifact scan.
