# Distinct Writer Close Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Preserve every operation and output-handle close failure from the shared distinct-file writer.

**Architecture:** Replace the masking `finally Promise.all()` with explicit operation capture, all-settled close collection, and a small error-combination helper reusing the module's existing aggregate flattening.

**Tech Stack:** Node.js 20+, TypeScript, Vitest injected file handles.

### Task 1: Reproduce Error Masking

**Files:**
- Modify: `tests/platform-files-failure.test.ts`

- [x] Inject two fake output handles plus a fake input stat.
- [x] Assert write + two close failures retain all ordered causes.
- [x] Assert successful writes + two close failures retain both causes.
- [x] Confirm focused tests fail because current `Promise.all()` exposes one close error only.

### Task 2: Implement Ordered Close Aggregation

**Files:**
- Modify: `src/platform/files.ts`
- Test: `tests/platform-files-failure.test.ts`

- [x] Capture operation success/failure without skipping handle closure.
- [x] Close all handles with `Promise.allSettled()` and flatten errors in open order.
- [x] Preserve exact lone-error identity and aggregate multi-error cases.
- [x] Run platform, compressor, new-chat, and error-format focused tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Document complete close-error visibility and unchanged write behavior.
- [x] Run the full suite, build, 22-file package dry-run, diff check, and residue scan.
- [x] Update the actual test count.
