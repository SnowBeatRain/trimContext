# Session Catalog Error Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Preserve expected missing-session behavior while surfacing non-`ENOENT` catalog failures accurately.

**Architecture:** Centralize the catalog's missing-path classification in a small predicate, use it at directory and file scan boundaries, and remove redundant catch-and-rewrite logic from the current-session fallback.

**Tech Stack:** Node.js 20+, TypeScript, Vitest filesystem mocks and real temporary directories.

### Task 1: Reproduce Hidden Catalog Errors

**Files:**
- Create: `tests/session-catalog-failure.test.ts`

- [x] Add partial `readdir` and `stat` mocks with restoration after every test.
- [x] Assert root `EACCES`, candidate `EIO`, and current-session fallback errors propagate by identity.
- [x] Assert a real home with missing roots still returns an empty catalog.
- [x] Run the focused test and confirm the non-`ENOENT` cases fail.

### Task 2: Implement ENOENT-Only Catalog Handling

**Files:**
- Modify: `src/sessions/catalog.ts`
- Modify: `src/sessions/binding.ts`
- Test: `tests/session-catalog-failure.test.ts`

- [x] Return empty/skip only when the caught error code is `ENOENT`.
- [x] Propagate all other directory and candidate inspection errors.
- [x] Remove the redundant latest-session catch from `resolveCurrentSessionFile()`.
- [x] Run session discovery, picker, CLI analyze, and new-chat focused tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Document the catalog error semantics and unchanged missing-root/rotation behavior.
- [x] Run the full suite, build, 22-file package dry-run, diff check, and residue scan.
- [x] Update the status document with the actual test count.
