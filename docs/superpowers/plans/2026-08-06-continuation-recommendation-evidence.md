# Report v2 Continuation Recommendation Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `clarify_continuation` name the exact continuation evidence gaps already recorded by Report v2.

**Architecture:** Pass the complete `ResumeReadiness` value into recommendation construction and derive machine copy from its fixed missing labels. Human renderers pass the same missing list to the shared localization helper; no Report v2 field or readiness calculation changes.

**Tech Stack:** Node.js 20+, TypeScript, Vitest

---

### Task 1: Capture The Incorrect Recommendation

**Files:**
- Modify: `tests/report-construction-boundaries.test.ts`
- Modify: `tests/format-summary.test.ts`
- Modify: `tests/report-markdown.test.ts`

- [ ] **Step 1: Add the constructor regression**

Call `createRecommendations()` with a partial readiness object whose missing list is `user decisions`, `active files`, and `test signals`. Assert that `clarify_continuation.summary` contains those three labels and contains neither `current goal` nor `next step`.

- [ ] **Step 2: Add presentation regressions**

Use the existing report fixtures with a non-ready readiness value. Assert terminal and Markdown recommendation copy enumerates the localized values from `readiness.missing` rather than the fixed current-goal/next-step sentence.

- [ ] **Step 3: Verify RED**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/report-construction-boundaries.test.ts tests/format-summary.test.ts tests/report-markdown.test.ts
```

Expected: the new constructor assertion fails because `createRecommendations()` still accepts only a level and returns fixed copy; presentation assertions fail because localization ignores the missing list.

### Task 2: Bind Recommendation Copy To Readiness Evidence

**Files:**
- Modify: `src/core/report-review.ts`
- Modify: `src/core/reporter.ts`
- Modify: `src/core/report-copy.ts`
- Modify: `src/cli/format-summary.ts`
- Modify: `src/core/report-markdown.ts`
- Modify: `tests/report-construction-boundaries.test.ts`

- [ ] **Step 1: Update recommendation construction**

Change the third parameter to `AnalysisReport["resume"]["readiness"]`. Use `readiness.level` for the existing gate and generate a fixed-prefix English summary followed by `readiness.missing.join(", ")` when the list is non-empty.

- [ ] **Step 2: Update facade and equality coverage**

Pass `resume.readiness` from `createReport()` and update the direct-constructor equality assertion to use the same value.

- [ ] **Step 3: Localize actual gaps**

Let `recommendationSummaryLabel()` accept `readonly string[]`. For `clarify_continuation`, map each value through `missingEvidenceLabel()` and join with `、`; keep every other code mapping unchanged. Pass the report's missing list from both renderers.

- [ ] **Step 4: Verify GREEN**

Run the three focused test files and require all tests to pass with no warnings or errors.

### Task 3: Synchronize Product Documentation

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the evidence binding**

Record that continuation recommendations name only categories present in `resume.readiness.missing`, with no schema or scoring change.

- [ ] **Step 2: Record representative audit evidence**

Record the aggregate private-report finding without copying private text, paths, IDs, or report bodies.

### Task 4: Verify The Complete Change

- [ ] **Step 1: Focused regression**

Run the constructor, summary, Markdown, reporter, and resume test files.

- [ ] **Step 2: Representative report audit**

Read the existing private reports without modifying them. Confirm that recomputed clarify copy lists exactly the stored missing categories and never lists a present category.

- [ ] **Step 3: Full quality gates**

Run:

```powershell
npm test
npm run build
npx vitest run --testTimeout=30000 tests/package-contents.test.ts
npm pack --dry-run --json --silent
git diff --check
```

Require 22 package files, zero forbidden paths, no generated `.tgz`, and no temporary validation residue. Do not modify `.vscode/`, private reports, or original transcripts.

This plan is authorized for inline execution in the current worktree. Do not commit, push, create a PR, change scorer/threshold/safety/compression behavior, or alter the six-command public surface.
