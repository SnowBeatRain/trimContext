# Hook Input Validation Design

## Context

Both hidden hook modes read JSON from stdin through `readStdinJson<T>()`. The helper
parses JSON and casts it directly to `T`, so its `HookInput` type provides no runtime
validation.

Real process reproductions show that malformed shapes reach unrelated internals:

- top-level `null` produces a JavaScript property-access error;
- a numeric SessionStart `transcript_path` or `session_id` produces a
  `value.replace` error in shell quoting;
- a numeric Stop `transcript_path` produces a Node path-type error.

These cases currently fail before writing the env file or project `CLAUDE.md`, but
their messages expose implementation details and vary by the downstream operation.
Raw JSON parse errors are also engine-defined and are not a stable privacy boundary.

## Decision

Create `src/core/hook-input.ts` as the single stdin parsing and runtime validation
boundary for SessionStart and Stop hooks.

The boundary will:

1. read stdin and trim surrounding whitespace as today;
2. treat empty stdin as an empty object so the existing caller-specific required-path
   errors remain unchanged;
3. parse non-empty input as JSON, wrapping parse failures as
   `Claude hook input must be valid JSON` without including raw input;
4. require the parsed top level to be a non-null, non-array object;
5. accept unknown object fields for forward compatibility with Claude hook payloads;
6. validate each present known field:
   - `transcript_path` must be a string;
   - `session_id` must be a string;
   - `stop_hook_active` must be a boolean;
7. return a new `HookInput` containing only the known validated fields.

`transcript_path` remains required by both callers, using their existing error copy.
An empty string therefore remains a missing path. `session_id` remains optional and
an empty string remains the explicit cleared-binding value. No path normalization or
session inference is introduced.

## Alternatives Rejected

- Validate independently in `writeSessionEnvBinding()` and `runHook()`: this would
  duplicate the same untrusted-input rules and allow the two hook modes to drift.
- Add a schema-validation dependency: three optional scalar fields do not justify a
  new runtime dependency or package surface.
- Keep generic casting and translate downstream errors: this would fix symptoms at
  shell/path call sites instead of validating at the source boundary.

## Error And Side-Effect Contract

Validation occurs before directory creation, env-file append, transcript analysis,
or `CLAUDE.md` access. Invalid input must exit nonzero with a stable field-specific
message and must not:

- create or change `CLAUDE_ENV_FILE`;
- create or change project `.claude/CLAUDE.md`;
- echo raw stdin or secrets embedded in malformed JSON;
- fall back to latest-session discovery.

Underlying parse errors may be retained as `cause` for programmatic diagnostics, but
the CLI continues to print only the outer message.

## Verification

Use two TDD cycles:

1. Add a process regression for malformed JSON containing a sentinel secret, verify
   the current message fails the stable-error assertion, then extract the compatible
   stdin parser into `hook-input.ts` while wrapping JSON parse errors.
2. Add direct shape/type cases and SessionStart/Stop process regressions, verify the
   current internal errors, then add runtime validation to the established boundary.

Verify that valid SessionStart snapshots, Stop analysis, transcript SHA-256 safety,
the six-command public surface, and packed-install tests remain unchanged. Finish
with the full test suite, TypeScript build, npm pack dry-run, and `git diff --check`.

## Non-Goals

- Limiting stdin byte size.
- Rejecting unknown Claude hook fields.
- Changing required-path or session-binding semantics.
- Validating transcript JSONL content at the hook-input boundary.
- Changing report, scoring, threshold, export, or compression behavior.
