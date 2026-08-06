# Hook Runtime Storage Safety Design

## Goal

Make the hidden Claude Stop hook fail closed when the project `.claude/CLAUDE.md` exists but cannot be read, and make managed-block updates atomic without changing SessionStart bindings, analysis behavior, or hook write scope.

## Confirmed Failure

`src/core/hook.ts` currently catches every `readFile()` failure in `readExistingClaudeMd()` and returns `undefined`. A real-filesystem reproduction with `.claude/CLAUDE.md` as a directory returned exit code 0 and reported low context pressure. The runtime therefore treated an existing unreadable path as a missing file.

The same module writes cleaned or updated content with direct `writeFile()` calls. An interrupted write can leave the shared project instruction file partially written even though `src/platform/files.ts` already provides the project's tested atomic replacement behavior.

## Approaches Considered

1. Extract a focused hook storage module. This is the recommended approach because it isolates filesystem policy, matches the recently established hook-installer boundary, and allows real-filesystem tests without coupling them to stdin or analysis.
2. Patch the catch and write calls inline in `core/hook.ts`. This is smaller, but leaves persistence policy mixed with hook orchestration and makes failure behavior harder to test directly.
3. Add locking, compare-and-swap, or a generic state repository. This could serialize simultaneous Stop hooks, but it changes the documented last-writer behavior and expands scope without current evidence.

## Architecture

Add `src/core/hook-storage.ts` with two narrow operations:

- `readClaudeMd(file)`: returns UTF-8 content, returns `undefined` only for `ENOENT`, and otherwise throws a contextual error that preserves the original failure as its cause.
- `writeClaudeMd(file, content)`: creates the parent directory and delegates replacement to `atomicWriteFile()`.

`src/core/hook.ts` continues to calculate the project path, read stdin, run the existing analysis pipeline, format the managed block, and decide whether an update is necessary. It delegates only CLAUDE.md persistence to the storage module.

SessionStart remains unchanged: it writes the current window binding only through `CLAUDE_ENV_FILE`. Stop continues to read the transcript and may modify only content between the existing trimctx markers in the project CLAUDE.md file. The transcript remains read-only.

## Data Flow

1. Stop parses `transcript_path` from stdin and calls the existing `analyzeFile()` pipeline.
2. Stop resolves `<cwd>/.claude/CLAUDE.md` and calls `readClaudeMd()`.
3. A missing file becomes empty content. Any other read failure aborts before a write.
4. Existing `injectContextStateSection()` either replaces, removes, or appends the managed block.
5. When a real update is required and the hook is not a dry run, `writeClaudeMd()` performs the atomic replacement.

## Error And Concurrency Semantics

- `ENOENT` is the only missing-file condition.
- Directory paths, permission failures, invalid path types, and other I/O failures are not downgraded to absence.
- Atomic replacement keeps an existing CLAUDE.md intact if commit fails and removes trimctx temporary files.
- No lock is introduced. Concurrent Stop hooks retain the documented last-successful-writer behavior, while each individual file replacement is atomic.
- Dry-run still reads existing content so it cannot conceal an unreadable target, but it performs no mkdir or write.

## Test Strategy

- Unit-test hook storage against the real filesystem for missing, existing, and non-ENOENT read cases.
- Verify create and replace writes leave no `.trimctx-` temporary files.
- Add Stop integration coverage showing unrelated CLAUDE.md content survives managed-block replacement and removal.
- Hash the source transcript before and after Stop integration runs.
- Keep the existing context-state tests as the pure marker transformation contract.
- Run targeted tests, the full Vitest suite, TypeScript build, package dry-run, and `git diff --check`.

## Non-Goals

- No scorer, threshold, safety, parser, report, compression, or discovery changes.
- No new command or public option.
- No SessionStart persistence changes.
- No locking or generalized project state framework.
- No changes outside the trimctx-managed CLAUDE.md block.

## Superseded Concurrency Note (2026-08-06)

The later
`2026-08-06-hook-claude-md-concurrent-write-safety-design.md` supersedes the
accepted last-successful-writer statement above. A deterministic A/B/A probe
showed that unconditional atomic replacement could overwrite bytes written
after the Stop hook's read. Hook storage now binds each proposed write to the
exact bytes, or exact absence, returned by that read and fails closed when the
target differs.

The conditional writer checks before staging, immediately before commit, and
again before the multi-step Windows replacement fallback. No lock or automatic
retry is introduced. Node's cross-platform filesystem API does not make the
final byte comparison and rename one indivisible operation, so the narrow
precheck-to-rename interval is explicitly not a fully linearizable CAS.
