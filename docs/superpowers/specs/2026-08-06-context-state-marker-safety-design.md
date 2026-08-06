# Context State Marker Safety Design

## Goal

Make trimctx refuse to modify `.claude/CLAUDE.md` when its managed state markers are incomplete, reversed, or duplicated, and preserve every byte outside one valid managed range during replacement or removal.

## Confirmed Failure

`injectContextStateSection()` currently checks only whether one start marker and one end marker can be found. It does not validate their order or uniqueness.

Real calls against the current function confirmed three unsafe outcomes:

- a lone start marker causes a second managed block to be appended;
- an end marker before a start marker duplicates overlapping user content;
- two complete blocks replace only the first and leave the second behind.

The valid-block path also changes bytes outside the markers: removal trims surrounding and trailing whitespace, while replacement inserts an extra newline before the existing suffix.

## Approaches Considered

1. Validate marker structure inside the pure context-state transform and replace only the exact marker range. This is preferred because every caller receives the same fail-closed behavior and the ownership rule remains local to the marker implementation.
2. Validate only in the Stop runtime. This protects the current process path but duplicates marker knowledge and leaves direct consumers unsafe.
3. Automatically heal malformed marker structures. This would require guessing which duplicated or unmatched content belongs to trimctx, risking user-content loss.

## Marker Contract

A CLAUDE.md input has only two valid marker states:

- no start marker and no end marker;
- exactly one start marker followed by exactly one end marker.

Every other structure is ambiguous and must throw `CLAUDE.md contains ambiguous trimctx state markers` before returning modified content. This includes a lone marker, reversed markers, duplicate starts, duplicate ends, and multiple complete blocks.

Marker detection is literal and independent of Markdown syntax. A marker-shaped string inside user prose or a code fence is still ambiguous ownership, so refusing to write is safer than guessing.

## Transformation Semantics

For one valid range, calculate:

- `before`: every byte before the start marker;
- `after`: every byte after the end marker.

Replacement returns `before + stateSection + after`. Removal returns `before + after`. The function performs no trimming and inserts no boundary whitespace, so all non-managed bytes remain unchanged.

For no markers, removal returns the original string unchanged. Addition retains the established append format, including its separating blank line and final newline.

## Runtime Behavior

The hidden Stop hook already calls `injectContextStateSection()` before `writeClaudeMd()`. A marker validation error therefore aborts both normal and dry-run execution before any atomic write. SessionStart remains independent and continues to write only `CLAUDE_ENV_FILE`.

## Test Strategy

- Add table-driven pure tests for lone, reversed, and duplicate marker structures.
- Add exact-string assertions proving replacement and removal preserve prefix/suffix bytes.
- Add a Stop dry-run process regression that expects nonzero exit, preserves malformed CLAUDE.md, and preserves transcript SHA-256.
- Retain all existing normal append, replace, and remove tests.
- Run context-state/hook/storage focused tests, then the complete test, build, package, and diff quality gates.

## Non-Goals

- No auto-repair, locking, marker migration, or new public command.
- No changes to the generated state content or timestamp.
- No parser, scorer, threshold, safety, report, or compression changes.
