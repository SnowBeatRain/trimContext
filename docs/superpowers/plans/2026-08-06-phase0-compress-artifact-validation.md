# Phase 0 Compress Artifact Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Count compression as successful in Phase 0 only when its required output artifact is present, regular, and readable.

**Architecture:** Add a focused compress-artifact validator beside analyze/report validation, preserve process results on command failure, and reuse existing contract-failure compaction and aggregation.

**Tech Stack:** Node.js 20+, TypeScript, Vitest injected runners plus a real CLI subprocess race test.

### Task 1: Reproduce Compress Contract Gaps

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Modify: `tests/phase0-run-safety.test.ts`

- [x] Make existing injected successful compress commands create their artifact.
- [x] Add missing/non-regular and failed-process injected tests.
- [x] Add a real-process test that removes the generated compressed artifact.
- [x] Confirm current code incorrectly keeps `compress.ok=true` and `compress_ok=1`.

### Task 2: Validate The Compress Artifact

**Files:**
- Modify: `scripts/phase0-run-sample.ts`
- Test: `tests/phase0-run-sample.test.ts`
- Test: `tests/phase0-run-safety.test.ts`

- [x] Validate successful output with ENOENT-only stat classification.
- [x] Require a regular target and successful read-handle open/close.
- [x] Store a compact contract failure with the original exit code.
- [x] Run focused Phase 0 result, safety, summary, and evidence tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Document complete analyze/report/compress contract semantics.
- [x] Run strict script type-checking and all quality gates.
- [x] Update the actual test count, confirm 22 package files, and scan residue.
