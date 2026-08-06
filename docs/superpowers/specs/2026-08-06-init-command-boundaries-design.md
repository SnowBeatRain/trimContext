# Init Command Boundaries Design

## Goal

Separate `init` option/path planning, interactive target selection, and filesystem installation while preserving the six-command CLI, packaged asset layout, prompts, output copy, hooks behavior, and install destinations. Prevent predictable multi-asset failures from leaving a partial installation.

## Evidence

`src/commands/init.ts` currently owns five concerns in one module:

- Commander option registration and stdout rendering;
- a module-level mutable `packageRoot` assigned during command registration;
- readline lifecycle, interactivity detection, answer normalization, and retry copy;
- Claude/Codex source and destination planning plus option parsing;
- source validation, destination conflict detection, recursive replacement, and copying.

End-to-end tests cover user/project installs, interactive selection, non-interactive errors, force, dry-run, hooks, invalid options, six-command help, package contents, and packed installation. They do not make the pure path plan independently inspectable, and the current installer checks and writes one asset at a time. With `--client all`, the Claude asset can be copied before a predictable Codex source/conflict error is discovered.

## Options Considered

1. Extract only pure asset planning. This removes the mutable package root but leaves prompt lifecycle and destructive filesystem behavior coupled to command registration.
2. Extract plan, prompt, and installer modules. Selected because each boundary has one clear input/output contract and can be tested without spawning the CLI, while `init.ts` remains the workflow coordinator.
3. Introduce a generic transactional installer/platform abstraction. This would exceed the needs of two fixed trimctx asset directories and add rollback complexity without a current product requirement.

## Module Boundaries

### `src/commands/init-plan.ts`

Owns pure option and path planning:

- exported `InitClient`, `InitTarget`, and `InitAsset` types;
- `parseInitClient()` and `parseInitTarget()` with the existing accepted values and error text;
- `createInitAssets(packageRoot, client, baseDir)` returning Claude and/or Codex assets in the current order.

`packageRoot` becomes an explicit argument. The module does not read `process`, prompt, or access the filesystem. User/project semantics remain in base-directory resolution; both targets intentionally use the same relative `.claude`/`.codex` layout.

### `src/commands/init-prompt.ts`

Owns interactive target resolution:

- `PromptSession` and readline lifecycle;
- `isInteractiveInput()` with production defaults and injectable environment/TTY facts;
- `resolveInitTarget()` using an optional prompt and output writer.

The accepted answers, default answer, retry message, prompt text, and non-interactive error remain exact. Direct tests use a small injected prompt instead of mutating stdin.

### `src/commands/init-installer.ts`

Owns asset filesystem work:

- `installInitAssets()` returns the existing `- <label>: <destination>` lines;
- readable-template checks;
- destination existence/conflict checks;
- trimctx-only replacement safety;
- parent creation and recursive copy.

For real installs, the installer preflights every template, destination conflict, and forced-replacement safety rule before the first copy/delete. Dry-run continues validating packaged templates and returning planned paths without checking destination conflicts or writing. This eliminates predictable half-installs without adding rollback or changing successful output.

### `src/commands/init.ts`

Remains the command facade and owns:

- Commander registration;
- target/base-directory orchestration;
- summary and next-step copy;
- optional Claude hook installation;
- final stdout rendering.

The registration closure captures its own `packageRoot`; no module-level mutable registration state remains.

## Data Flow

The command action parses the client, creates a prompt only when the target is omitted and input is interactive, resolves the target, resolves the base directory, and asks the plan module for fixed assets. The installer preflights and applies those assets, then the command optionally invokes the existing hook installer and appends unchanged next-step copy.

Errors continue to propagate to the CLI's existing top-level handler. Prompt sessions close in `finally`. Filesystem execution stays sequential after preflight so output ordering remains Claude then Codex.

## Compatibility And Safety

- No new command, option, environment variable, dependency, asset, or install destination.
- `init`, `analyze`, `report`, `export`, `new-chat`, and `compress` remain the only public commands.
- Default client remains `all`; target remains required in non-interactive mode and prompted otherwise.
- User and project destinations remain `<base>/.claude/plugins/trimctx` and `<base>/.codex/skills/trimctx`.
- Existing destinations still require `--force`; forced deletion is still limited to a final path component exactly equal to `trimctx`.
- Dry-run still writes no assets or hook settings and omits post-install next steps.
- `--with-hooks` remains Claude/all only and uses the existing `installHooks()` behavior and copy.
- Successful stdout lines, prompts, validation messages, next steps, packed asset layout, and hook scope remain unchanged.
- No parser, report, scorer, threshold, safety, compression, transcript, or session-discovery behavior changes.

## Testing

- Add direct RED/GREEN tests for parsing and deterministic asset planning with two different package roots.
- Add direct prompt tests for default/user/project aliases, retry behavior, and non-interactive failure using injected prompt/output dependencies.
- Add direct installer tests for dry-run, non-force conflict, force replacement safety, and multi-asset preflight preventing partial writes.
- Keep existing CLI init, interactive, hooks, package contents, packed-install, and six-command tests unchanged.
- Run focused init/hook tests, then `npm test`, `npm run build`, `npm pack --dry-run --json --silent`, and `git diff --check`.

## Out Of Scope

- Transactional rollback for unpredictable mid-copy operating-system failures.
- Changing hook JSON merge behavior or Stop/SessionStart write scope.
- Adding new clients, configurable destination layouts, uninstall/update commands, or a new installer.
- Changing successful install copy, prompts, or the six-command surface.
