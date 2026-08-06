# Session Discovery Boundaries Design

## Goal

Separate local session catalog discovery from trusted current-window binding validation without changing the six-command CLI surface, discovery roots, sorting, fallback behavior, error copy, or transcript read-only guarantees.

## Evidence

`src/sessions/discovery.ts` currently owns five different responsibilities in one 225-line module:

- Claude/Codex root construction;
- recursive JSONL metadata scanning;
- latest-session selection;
- `TRIMCTX_TRANSCRIPT_PATH` / `TRIMCTX_SESSION_ID` validation;
- user-facing source parsing and repair guidance.

The catalog path depends on `homedir()`, while the binding path reads `process.env` directly. Tests therefore mix filesystem behavior with global environment mutation, and command consumers cannot depend on the narrower capability they actually use. The pipeline and command registration layers are already split, so session discovery is the next remaining boundary in the documented refactor sequence.

## Options Considered

1. Split `reporter.ts`. It is the largest core module, but its semantics were just changed in the same uncommitted worktree. Splitting it now would increase overlap and verification cost.
2. Split `commands/init.ts`. This improves installer maintainability but does not address the higher-risk current-window versus latest-session boundary.
3. Split session discovery by capability. Selected because it follows the existing execution plan and makes trusted binding behavior independently testable without expanding product behavior.

## Module Boundaries

### `src/sessions/catalog.ts`

Owns local session metadata discovery:

- `SessionSource`, `ConcreteSessionSource`, and `SessionCandidate`;
- `sessionRoots()` and source/root mapping;
- recursive JSONL metadata scanning;
- `listSessions()`, `findLatestSession()`, and the legacy `findLatestJsonlUnder()` helper;
- `parseSessionSource()`, `prettyHomePath()`, and no-session help text.

Catalog functions accept an optional home directory where useful. Production defaults remain `homedir()`. Discovery stays read-only and does not parse transcript bodies.

### `src/sessions/binding.ts`

Owns trusted and compatibility resolution:

- `hasCurrentSessionBinding()`;
- `resolveBoundSessionFile()`;
- `resolveCurrentSessionFile()` for the existing binding-first/latest-fallback `new-chat` behavior;
- missing/invalid binding repair text.

Binding functions accept an optional environment object. Production defaults remain `process.env`. Strict resolution still requires a readable ordinary file and retains the approved filename rule: the basename without extension must equal or contain `TRIMCTX_SESSION_ID`.

### `src/sessions/discovery.ts`

Becomes a compatibility facade that re-exports catalog and binding APIs. Existing imports, including `src/core/session.ts`, continue to work. New code and focused tests may import the narrower modules directly.

## Compatibility And Safety

- No new command, option, environment variable, scan root, or output field.
- `listSessions()` remains sorted by descending mtime with file-path tie-breaking.
- Missing directories and files rotated during scanning remain non-fatal.
- `resolveBoundSessionFile()` never falls back to latest.
- `resolveCurrentSessionFile()` preserves binding-first/latest fallback for `new-chat` only.
- Session ID matching, localized error messages, and picker behavior remain unchanged.
- No parser, scorer, threshold, report, safety, compression, hook write, or transcript write behavior changes.

## Testing

- Add boundary tests that import the new modules and verify facade identity.
- Verify binding resolution with an injected environment without mutating `process.env`.
- Verify latest-session resolution with an injected home directory.
- Retain existing session, CLI, export, new-chat, hook, packed-install, and package-content tests.
- Run `npm test`, `npm run build`, `npm pack --dry-run --json --silent`, and `git diff --check`.
