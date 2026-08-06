# Compress Atomic Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Preserve existing compressed copies on write failures and reject input changes that occur after the compression snapshot is read.

**Architecture:** Reuse the existing input-bound atomic writer with a pre-read `FileHandle.stat()` snapshot; keep all compression transformation code unchanged.

**Tech Stack:** Node.js 20+, TypeScript, Vitest mocked `open()` with real temporary files.

### Task 1: Reproduce Direct-Write Risks

**Files:**
- Create: `tests/compressor-output-failure.test.ts`

- [x] Inject an output-handle write failure and assert an existing target remains unchanged.
- [x] Mutate the input when output preparation opens and assert the command rejects before replacing the target.
- [x] Assert owned temp files are cleaned and the first test leaves the input hash unchanged.
- [x] Run the focused test and confirm both cases fail against the direct writer.

### Task 2: Use Input-Bound Atomic Replacement

**Files:**
- Modify: `src/core/compressor.ts`
- Test: `tests/compressor-output-failure.test.ts`

- [x] Capture the input stat before `readFile()`.
- [x] Replace `writeFileDistinctFromInput()` with `atomicWriteFileDistinctFromInput()` and pass the snapshot.
- [x] Run compressor, platform file, CLI command, and Phase 0 focused tests.

### Task 3: Synchronize And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`

- [x] Document atomic replacement, existing-target preservation, and pre-read consistency.
- [x] Run the full suite, build, 22-file package dry-run, diff check, and residue scan.
- [x] Update the actual test count and confirm successful output bytes/decision behavior remain unchanged.
