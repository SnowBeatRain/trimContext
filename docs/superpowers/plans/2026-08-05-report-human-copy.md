# Report Human Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chinese human-readable report surfaces coherent and non-repetitive while preserving the Report v2 machine contract.

**Architecture:** A pure presentation-copy module maps stable report values to Chinese. The terminal and Markdown renderers consume it; report construction remains unchanged.

**Tech Stack:** TypeScript, vitest, commander.

---

### Task 1: Specify terminal summary behavior

**Files:**
- Modify: `tests/format-summary.test.ts`
- Modify: `tests/cli-analyze.test.ts`

- [x] Assert localized status, confidence, assessment, missing continuation evidence, and recommendation copy.
- [x] Assert limitation findings are not repeated as ordinary findings.
- [x] Run `npx vitest run tests/format-summary.test.ts tests/cli-analyze.test.ts` and confirm the assertions fail for the current mixed-language output.

### Task 2: Specify Markdown report behavior

**Files:**
- Modify: `tests/report-markdown.test.ts`

- [x] Assert localized conclusion, dimension summaries, finding action, continuation state, recommendation, and booleans.
- [x] Preserve existing redaction, escaping, evidence, and command assertions.
- [x] Run `npx vitest run tests/report-markdown.test.ts` and confirm the new assertions fail for the current output.

### Task 3: Implement shared presentation copy

**Files:**
- Create: `src/core/report-copy.ts`
- Modify: `src/cli/format-summary.ts`
- Modify: `src/core/report-markdown.ts`

- [x] Add exhaustive mappings for stable status, confidence, levels, recommendations, actions, resume labels, known finding codes, and generated dimension summaries.
- [x] Keep original text as the fallback for unknown future values.
- [x] Use the shared copy in both renderers and filter limitation findings from the terminal finding list.
- [x] Run the three focused test files and confirm they pass.

### Task 4: Verify behavior and release gates

**Files:**
- Modify only if evidence exposes a regression.

- [x] Inspect `analyze` output for Claude Code, OpenAI, and Codex fixtures.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json` and inspect the packaged command/assets contract.
- [x] Run `git diff --check` and inspect `git status --short` without touching user-owned `.vscode/` files.
