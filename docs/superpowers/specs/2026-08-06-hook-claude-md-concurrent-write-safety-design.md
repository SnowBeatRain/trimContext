# Hook CLAUDE.md Concurrent Write Safety Design

## Goal

Prevent the Claude Stop hook from silently overwriting project `CLAUDE.md`
bytes that changed after the hook read them, while preserving the existing
managed-block ownership, atomic replacement, transcript read-only contract,
and public CLI behavior.

## Confirmed Failure

The Stop path currently performs an unconditional read-transform-write:

1. `runHook()` reads `CLAUDE.md` as a string.
2. Another process or editor replaces A with B.
3. `runHook()` transforms stale A into C.
4. `writeClaudeMd()` atomically replaces B with C.

A deterministic real-filesystem probe reproduced this sequence. The final file
contained the stale A text and the new trimctx block, but not B. Atomic
replacement prevents partial files; it does not bind a write to the bytes that
were used to calculate it.

The same problem exists when the initial read reports no file and another
actor creates `CLAUDE.md` before the hook commits. The current write silently
replaces that new file.

## Approaches Considered

1. Exact-byte optimistic compare-and-swap, failing closed on conflict. This is
   the selected approach. It directly addresses the reproduced stale snapshot,
   distinguishes an absent file from an empty file, reuses the existing atomic
   writer, and does not add persistent coordination state.
2. A trimctx lock file plus a content check. This can serialize cooperating
   Stop hooks, but editors do not honor the lock. It also adds stale-lock,
   timeout, and crash-recovery policy that is not justified by the current
   failure.
3. Re-read, rebase, and retry automatically. This could preserve an edit seen
   during a retry, but it silently restores last-writer behavior, needs a retry
   limit, and makes conflicts less visible. A failed Stop is safer and more
   auditable than guessing how to merge shared project instructions.

## Architecture

### Platform atomic writer

Add a focused sibling to `atomicWriteFile()`:

```ts
atomicWriteFileIfUnchanged(
  outputFile: string,
  data: string,
  expectedContent: Uint8Array | undefined,
  conflictMessage?: string
): Promise<void>
```

`undefined` means that the target was absent. A zero-length byte array means
that the target existed and was empty. The function copies the caller's byte
snapshot before awaiting, checks the current target before temporary-file
preparation, writes and closes the same-directory temporary file, then checks
again immediately before commit. A mismatch throws the caller-supplied stable
error without exposing file contents or hashes.

The private atomic writer already accepts a `beforeCommit` callback. The new
operation uses that boundary without changing unconditional callers such as
hook installation. On the Windows replacement fallback, the callback runs once
more after the first rename failure and target inspection, immediately before
the target is moved to its backup path.

Every failed comparison retains the current target and uses the existing temp
ownership cleanup rules. Non-`ENOENT` inspection failures remain real errors;
they are not treated as absence or conflict.

### Hook storage snapshot

Change `readClaudeMd()` to return either `undefined` for `ENOENT` or one object
containing both:

- the UTF-8 string used by `injectContextStateSection()`;
- the exact Buffer read from disk, used only as the expected write snapshot.

Change `writeClaudeMd()` to require that read result, including `undefined` for
an absent file, and delegate to `atomicWriteFileIfUnchanged()`. This keeps byte
identity and hook-specific error wording inside the storage boundary.

`runHook()` uses `snapshot?.content` for its existing decisions and passes the
same snapshot to every real write. Dry-run still reads and validates the file
but never creates a directory or writes.

## Data Flow

1. Stop validates stdin and analyzes the transcript exactly as it does now.
2. Stop reads the project `CLAUDE.md` once through `readClaudeMd()`.
3. The existing pure managed-block transform calculates the proposed output
   from the returned string.
4. If no write is needed, Stop returns without filesystem mutation.
5. A real update stages the complete proposed file in a same-directory temp.
6. The atomic writer compares the current target bytes or absence with the
   captured snapshot immediately before replacement.
7. A match commits the existing atomic replacement. A mismatch aborts, cleans
   the temp, preserves the current target, and reports
   `CLAUDE.md changed while the Stop hook was preparing an update`.

## Conflict Semantics

- Existing A, current B: reject and preserve B.
- Existing A, current missing: reject and preserve absence.
- Initial missing, current B: reject and preserve B.
- Initial missing, current missing: allow creation.
- Existing empty file, current missing: reject; empty and absent are distinct.
- Current bytes exactly equal the snapshot: allow, even if another actor wrote
  the same bytes, because the calculated output cannot discard a byte change.
- A conflict is not retried automatically.

Node's standard cross-platform filesystem API does not provide one operation
that compares arbitrary file bytes and conditionally renames a replacement.
The design therefore detects changes visible at the final pre-commit check but
cannot eliminate the narrow interval between that check and the operating
system rename. The Windows fallback performs an additional check before its
multi-step replacement. This limitation must not be described as a fully
linearizable filesystem CAS.

## Test Strategy

- Platform real-filesystem tests cover matching existing content, changed
  content, deleted content, missing-to-created content, and temp cleanup.
- A storage regression reproduces read A, external write B, attempted stale C
  and requires a stable conflict while preserving B byte-for-byte.
- A second storage regression covers an initially missing file created by
  another actor before commit.
- Windows-only failure injection changes the target after the first rename
  attempt and proves the fallback's second check preserves the changed target.
- Existing Stop replacement/removal integration tests continue to prove that
  unrelated project text survives normal writes and source transcript hashes
  remain unchanged.
- Run targeted Vitest tests, the complete suite, strict TypeScript checks,
  build, packed/fresh-install smoke, package dry-run, `git diff --check`, and a
  post-fix real-filesystem A/B/A probe.

## Documentation

Update the earlier hook runtime storage design to supersede its accepted
last-successful-writer statement. Record the new fail-closed behavior and the
non-linearizable residual window in the changelog and current status document.
No user-facing command or option documentation changes are required.

## Non-Goals

- No lock file, retry loop, automatic merge, watcher, or generalized state
  repository.
- No changes to context-state formatting or marker ownership.
- No changes to SessionStart bindings.
- No scorer, threshold, parser, report, compression, session discovery, or
  public six-command changes.
- No writes to source transcripts.
