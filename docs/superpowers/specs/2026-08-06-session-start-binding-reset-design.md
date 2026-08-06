# SessionStart Binding Reset Safety Design

## Context

Claude Code SessionStart hooks append environment assignments to the window-specific
`CLAUDE_ENV_FILE`. trimctx currently always appends `TRIMCTX_TRANSCRIPT_PATH`, but
appends `TRIMCTX_SESSION_ID` only when the hook input contains a truthy `session_id`.

When one SessionStart writes both values and a later SessionStart for the same env
file omits `session_id`, the later transcript path overrides the old path while the
old session ID remains active. Bound commands then see an inconsistent pair and can
reject the new transcript.

## Decision

Each successful SessionStart write is a complete trimctx binding snapshot:

```sh
export TRIMCTX_TRANSCRIPT_PATH='<hook transcript_path>'
export TRIMCTX_SESSION_ID='<hook session_id or empty string>'
```

`transcript_path` remains required. `session_id` remains optional. When it is absent
or empty, trimctx appends `export TRIMCTX_SESSION_ID=''` so shell evaluation clears
any earlier ID instead of retaining stale state.

The hook continues to append through the window-specific `CLAUDE_ENV_FILE`; it does
not rewrite the file, discover another session, infer an ID from the filename, or
modify the transcript.

## Alternatives Rejected

- Reject SessionStart input without `session_id`: this would make an existing
  optional field mandatory and prevent a valid transcript-only binding.
- Infer the ID from the transcript filename: this would replace trusted hook data
  with a naming convention and could create a false identity.
- Leave the ID untouched when absent: this preserves the reproduced stale-binding
  failure.

## Data Flow And Errors

1. Parse the SessionStart JSON from stdin.
2. Require a non-empty `transcript_path` and a configured `CLAUDE_ENV_FILE` as today.
3. Build both export lines before writing.
4. Shell-quote both values with the existing quoting function.
5. Append both lines in one `appendFile()` call.

Existing filesystem errors continue to propagate. No partial fallback, latest-session
lookup, or destructive rewrite is introduced.

## Verification

Add a process-level regression that:

1. runs SessionStart with an old transcript and old session ID;
2. runs SessionStart again against the same env file with a new transcript and no ID;
3. confirms the env file ends with an empty ID assignment;
4. evaluates the accumulated bindings and confirms the old ID is gone;
5. runs `analyze --json` through the resulting binding and confirms it selects the
   new transcript;
6. confirms both transcript files remain byte-for-byte unchanged.

Run the focused hook test, the complete test suite, TypeScript build, npm pack dry
run, and `git diff --check`.

## Non-Goals

- Changing report, scoring, threshold, compression, or export behavior.
- Changing bound-session validation.
- Replacing append-only Claude environment persistence.
- Adding session discovery or filename-derived identity.
