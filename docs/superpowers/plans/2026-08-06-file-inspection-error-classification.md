# File Inspection Error Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Make shared file identity and Windows replacement inspection fail closed for non-`ENOENT` filesystem errors without changing successful write behavior.

**Architecture:** Add one ENOENT-only stat helper inside `platform/files.ts`, reuse it in identity and regular-file checks, and aggregate a Windows rename failure with a subsequent inspection failure.

**Tech Stack:** Node.js 20+, TypeScript, Vitest filesystem mocks and real temporary files.

### Task 1: Reproduce Error Downgrades

**Files:**
- Modify: `tests/platform-files-failure.test.ts`

- [x] Mock `stat()` through the existing partial `node:fs/promises` mock.
- [x] Assert `sameFile()` propagates an injected `EACCES` instead of returning `false`.
- [x] On Windows, assert a failed commit rename plus failed target inspection retains both errors, preserves the old output, and cleans the temp file.
- [x] Run the focused test and confirm both regressions fail for the expected reasons.

### Task 2: Implement ENOENT-Only Inspection

**Files:**
- Modify: `src/platform/files.ts`
- Test: `tests/platform-files-failure.test.ts`

- [x] Add `statIfExists()` and use it in `sameFile()` and `isRegularFile()`.
- [x] Aggregate ordered rename and inspection causes in the Windows fallback.
- [x] Run platform file and affected CLI write tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Document the ENOENT-only classification and unchanged successful behavior.
- [x] Run `npm test`, `npm run build`, `npm pack --dry-run --json --silent`, and `git diff --check`.
- [x] Update the status document with the actual test count and confirm 22 package files plus no `.tgz`, `.stage`, or `.bak` residue.
