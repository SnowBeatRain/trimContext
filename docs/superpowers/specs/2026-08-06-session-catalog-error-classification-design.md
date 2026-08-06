# Session Catalog Error Classification Design

## Problem

The local session catalog currently catches every `readdir()` failure as an empty directory and every per-file `stat()` failure as a rotated-away session. `resolveCurrentSessionFile()` then catches every latest-session error and replaces it with generic no-session help.

Missing Claude/Codex roots and files disappearing during client rotation are expected. Permission, I/O, descriptor exhaustion, and other failures are not evidence that no session exists. Downgrading them can make `analyze --latest`, interactive selection, or the `new-chat` fallback silently use incomplete discovery or report a misleading absence.

## Decision

Treat only `ENOENT` as an expected missing root, directory, or rotating file:

- root or nested-directory `readdir()` with `ENOENT` returns no candidates for that subtree;
- per-file `stat()` with `ENOENT` skips that one disappearing file;
- every other catalog filesystem error propagates unchanged;
- `resolveCurrentSessionFile()` reuses `findLatestSession()` directly, because that function already produces the existing no-session help when a completed scan has no candidates.

Auto-source discovery remains deterministic: a non-missing error in either requested source root aborts instead of presenting a partial catalog as complete.

## Compatibility

Missing roots, normal client file rotation, sort order, source filters, candidate metadata, binding-first behavior, no-session copy, and the public command surface remain unchanged. Only previously hidden non-`ENOENT` failures become visible.

## Verification

- Inject a root `readdir()` `EACCES` and require `listSessions()` to propagate it.
- Inject a candidate `stat()` `EIO` and require the scan to propagate it.
- Require `resolveCurrentSessionFile()` to preserve a catalog failure rather than replacing it with no-session help.
- Keep real missing-root discovery returning an empty list.
- Run focused session/CLI tests and the complete quality gates.
