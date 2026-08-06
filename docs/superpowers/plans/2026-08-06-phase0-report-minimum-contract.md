# Phase 0 Report Minimum Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Prevent structurally unusable JSON objects from inflating Phase 0 analyze/report success counts.

**Architecture:** Add one minimum Report v2 type guard in the per-sample validator and reuse it after independent JSON parsing for analyze stdout and report artifacts.

**Tech Stack:** Node.js 20+, TypeScript, Vitest injected runner/filesystem fixtures.

### Task 1: Reproduce Minimum-Contract False Positives

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`

- [x] Add a shared valid minimum Report v2 fixture builder.
- [x] Update existing successful analyze/report fixtures to use it.
- [x] Add wrong-contract analyze and report cases with private sentinels.
- [x] Confirm current object-only checks incorrectly keep both results successful.

### Task 2: Implement Shared Shape Guard

**Files:**
- Modify: `scripts/phase0-run-sample.ts`
- Test: `tests/phase0-run-sample.test.ts`

- [x] Validate version, input/source, summary counts/diagnostics, arrays, and warning strings.
- [x] Distinguish parse/top-level errors from minimum-contract errors.
- [x] Reuse the guard for analyze and report without changing metadata preference.
- [x] Run focused Phase 0 run, summary, evidence, and review tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Document the minimum schema and full-schema limitation.
- [x] Run strict scripts TypeScript and complete quality gates.
- [x] Update actual test count, confirm 22 package files, and scan residue.
