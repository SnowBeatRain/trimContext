# Context State Marker Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits in this working tree.

**Goal:** Reject ambiguous trimctx state markers and preserve all CLAUDE.md bytes outside one valid managed range.

**Architecture:** Keep marker ownership and validation in the pure `context-state.ts` transform. Parse zero or one ordered marker pair, throw for every ambiguous structure, and concatenate the untouched prefix/suffix around replacement content without trimming or injected boundary whitespace.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, existing Claude hook process test helpers.

---

### Task 1: Define Marker Validation And Byte Preservation

**Files:**
- Modify: `tests/context-state.test.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add pure failing tests**

Add exact-string replacement/removal cases:

```ts
const content = `prefix \t\n${start}\nold\n${end}\n\n suffix  \n\n`;
expect(injectContextStateSection(content, `${start}\nnew\n${end}`)).toBe(
  `prefix \t\n${start}\nnew\n${end}\n\n suffix  \n\n`
);
expect(injectContextStateSection(content, "")).toBe("prefix \t\n\n\n suffix  \n\n");
```

Add table-driven invalid structures for a lone start, lone end, reversed pair, duplicate start, duplicate end, and two complete pairs. Each call must throw `CLAUDE.md contains ambiguous trimctx state markers` for both replacement and removal.

- [x] **Step 2: Add a failing Stop integration test**

Create a temporary project containing a lone start marker in `.claude/CLAUDE.md`, run `hook --dry-run` against the low-pressure fixture, and assert:

- nonzero exit with the ambiguous-marker message;
- CLAUDE.md is byte-identical to its pre-run content;
- transcript SHA-256 is unchanged.

- [x] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npx vitest run tests/context-state.test.ts tests/hook.test.ts
```

Expected: exact removal/replacement and ambiguous-marker assertions fail because the current transform trims/inserts whitespace and does not validate marker structure.

### Task 2: Implement Strict Marker Range Parsing

**Files:**
- Modify: `src/core/context-state.ts`

- [x] **Step 1: Add a private marker index collector**

Implement a literal scanner that returns every non-overlapping index for a marker:

```ts
function markerIndexes(content: string, marker: string): number[] {
  const indexes: number[] = [];
  let offset = 0;
  while (offset <= content.length - marker.length) {
    const index = content.indexOf(marker, offset);
    if (index === -1) break;
    indexes.push(index);
    offset = index + marker.length;
  }
  return indexes;
}
```

- [x] **Step 2: Parse zero or one ordered range**

Add a private helper returning `undefined` for zero markers and `{ start, end }` for one ordered pair. Throw `new Error("CLAUDE.md contains ambiguous trimctx state markers")` unless start/end counts match the two valid states or when the end index precedes the start index.

- [x] **Step 3: Replace only the exact managed range**

Update `injectContextStateSection()` to use the parsed range:

```ts
if (range) {
  const before = claudeMdContent.slice(0, range.start);
  const after = claudeMdContent.slice(range.end);
  return stateSection ? `${before}${stateSection}${after}` : `${before}${after}`;
}
```

Keep the current no-marker append and empty-section branches unchanged.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run tests/context-state.test.ts tests/hook.test.ts tests/hook-storage.test.ts
```

Expected: every focused test passes, malformed content remains unchanged, and transcript hashes remain stable.

### Task 3: Verify And Record The Contract

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-context-state-marker-safety.md`

- [x] **Step 1: Run complete quality gates**

Run:

```bash
npm test
npm run build
npm pack --dry-run --json --silent
git diff --check
```

Expected: zero failures, successful build, 22 package files without private artifacts, and no whitespace errors.

- [x] **Step 2: Recheck scope**

Confirm the public six-command help output, SessionStart/Stop write scope, no generated tarball, untouched `.vscode/`, and no task edits to parser/scorer/threshold/safety/report/compression.

- [x] **Step 3: Update status and plan checkboxes**

Record the three reproduced failure shapes, strict marker contract, exact byte preservation, new regression counts, and fresh quality-gate results. Mark a checkbox only after its action and verification are complete.
