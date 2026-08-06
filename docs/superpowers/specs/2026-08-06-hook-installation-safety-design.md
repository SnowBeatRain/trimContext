# Hook Installation Safety Design

## Goal

Make Claude hook installation preserve invalid/unreadable settings and unrelated hooks inside mixed groups, then separate pure settings planning from filesystem persistence without changing the hidden hook command, `init --with-hooks` workflow, dry-run privacy, or SessionStart/Stop scope.

## Confirmed Root Causes

Two failures were reproduced directly against the current `installHooks()` using temporary settings files:

1. A file containing `{broken` was reported as successfully installed and replaced by a new hooks-only document. The read/parse block catches every error, so JSON syntax errors and filesystem failures are indistinguishable from a missing file.
2. With `--force`, a group containing both a trimctx hook and a user hook was replaced by a trimctx-only group. Force filtering runs at the group level, so any matching hook causes the entire group to be removed.

The command facade is not the source of either failure. Both originate in settings I/O/planning inside `src/commands/hook.ts`. A third risk remains: successful settings are written directly with `writeFile()`, unlike report/export outputs that use same-directory atomic replacement.

## Options Considered

1. Patch the two conditionals in `hook.ts`. This is the smallest diff, but leaves parsing, schema assumptions, merge policy, dry-run redaction, and persistence coupled to command registration.
2. Extract pure settings planning and hook installation, plus reuse a generic atomic-write primitive. Selected because it isolates both root causes, makes preservation rules directly testable, and follows the project's existing atomic replacement pattern.
3. Build a general Claude settings schema/migration framework with transactional backups. This exceeds the fixed SessionStart/Stop hook requirement and would expand the integration surface without evidence.

## Module Boundaries

### `src/commands/hook-settings.ts`

Owns pure hook planning:

- trimctx SessionStart and Stop command constants;
- minimal hook entry/group/settings structural types;
- `planHookSettings(settings, { force })`;
- `plannedHookSettings()` for the existing privacy-safe dry-run preview.

The planner validates only the containers it must iterate: the root must be an object, `hooks` must be an object when present, SessionStart/Stop must be arrays when present, each group must be an object, each present group `hooks` value must be an array, and each hook entry must be an object. Unknown root fields, hook events, group fields, and hook fields are preserved.

Without force, existing trimctx hooks are detected exactly as before; both present returns `already_installed`, while missing hooks are appended. With force, only matching hook entries are removed. A group containing unrelated entries survives with those entries and its other fields intact; an emptied trimctx-only group is removed. Exactly one current trimctx hook group is then appended per event.

### `src/commands/hook-installer.ts`

Owns settings persistence:

- `installHooks(settingsPath, options)`;
- missing-file versus read-error handling;
- JSON parsing and actionable invalid-settings errors;
- dry-run/already-installed result copy;
- serialization and atomic write.

Only `ENOENT` creates an empty settings object. Other read errors propagate with the settings path. Invalid JSON or invalid required containers fail before any write and do not include file contents in errors. Dry-run remains privacy-safe by rendering only `plannedHookSettings()`, never the merged existing document.

### `src/commands/hook.ts`

Retains only hidden Commander command creation for Stop/SessionStart execution. `src/commands/init.ts` imports `installHooks()` from the installer module directly.

### `src/platform/files.ts`

Adds `atomicWriteFile(outputFile, data)`. It uses the same same-directory temp file, exclusive creation, Windows replacement fallback, backup restore, and cleanup logic as `atomicWriteFileDistinctFromInput()`. The transcript-specific API keeps its input identity/snapshot checks and delegates only the shared temp-write/replace mechanics.

## Data Flow

`init --with-hooks` completes asset installation, then calls the hook installer. The installer reads settings or creates an empty object only for ENOENT, parses JSON, asks the pure planner for a result, and returns early for already-installed/dry-run cases. A real changed plan is serialized with the existing two-space indentation and trailing newline, then atomically replaces `settings.json` in the same directory.

The hidden `trimctx hook` SessionStart/Stop runtime remains independent and unchanged.

## Compatibility And Safety

- No new public command, option, environment variable, dependency, hook event, or managed file.
- Hook commands remain `trimctx hook --session-start` and `trimctx hook`.
- `--with-hooks`, `--force`, and `--dry-run` output copy remains unchanged on established success paths.
- Dry-run never prints existing settings, credentials, permissions, or arbitrary user hook content.
- Missing settings still install from an empty object; valid settings preserve unknown fields and unrelated events.
- Invalid JSON, invalid required containers, and non-ENOENT read failures now fail closed and preserve the original file.
- Force removes only trimctx hook entries, not unrelated entries sharing their group.
- Settings replacement becomes atomic and cleans temporary/backup files; failure preserves the existing target where the platform permits restoration.
- Stop may still update only the trimctx-managed `.claude/CLAUDE.md` block; SessionStart still writes only environment bindings through `CLAUDE_ENV_FILE`.
- No parser, report, scorer, threshold, safety, compression, transcript, session-discovery, or six-command behavior changes.

## Testing

- Add RED integration tests proving invalid JSON is currently overwritten and mixed groups currently lose user hooks.
- Add direct pure-planner tests for missing hooks, already-installed hooks, mixed-group force preservation, unknown-field preservation, and invalid containers.
- Add installer tests for ENOENT, invalid JSON preservation, dry-run privacy, and atomic output.
- Add platform tests for generic atomic create/replace and injected commit failure cleanup/preservation.
- Keep existing init, hook runtime, package contents, packed-install, and six-command tests.
- Run focused tests, then `npm test`, `npm run build`, `npm pack --dry-run --json --silent`, and `git diff --check`.

## Out Of Scope

- Changing hook runtime analysis, context-state formatting, or CLAUDE.md ownership.
- Managing hook matchers, timeouts, additional Claude events, uninstall, or migration commands.
- Repairing malformed settings automatically or echoing their contents.
- Providing rollback across the earlier asset install and later settings install as one transaction.
