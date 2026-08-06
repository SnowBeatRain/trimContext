# Observability Warning Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all Report v2 warnings while preventing report behavior notices from changing the observability assessment.

**Architecture:** Create typed internal warning diagnostics at the diagnostics boundary, then derive the complete public warning list and the narrower assessment warning list from those diagnostics. Keep the assessment algorithm and all public report fields unchanged.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest.

---

### Task 1: Lock the warning trust boundary with integration tests

**Files:**
- Modify: `tests/reporter.test.ts`

- [x] **Step 1: Add the failing report-only warning test**

Create an exact-token `compress_candidate` message and assert both projections:

```ts
const report = createReport([candidate], "session.jsonl");
expect(report.warnings).toContain(
  "compress_candidate messages are report-only in this version and are kept during compression."
);
expect(report.assessment.dimensions.observability).toMatchObject({
  level: "low",
  score: 0,
  evidence_count: 0
});
```

- [x] **Step 2: Strengthen genuine limitation coverage**

Assert that an approximate-token warning and a compact-session warning remain observability evidence. Use exact token metadata in the compact case to isolate compaction from tokenization.

- [x] **Step 3: Run the focused test and verify RED**

Run: `npx vitest run tests/reporter.test.ts`

Expected: the report-only case fails because current observability is `medium`, score `0.5`, and evidence count `1`; the genuine limitation assertions continue to pass.

### Task 2: Add structured warning diagnostics

**Files:**
- Modify: `src/core/diagnostics.ts`
- Modify: `src/core/reporter.ts`
- Modify: `src/core/assessment.ts`

- [x] **Step 1: Define the internal diagnostic contract**

Add an `AnalysisWarningDiagnostic` with `text` and `affectsObservability`, then create diagnostics in the existing stable order: compact session, approximate tokens, report-only compression notice.

```ts
export interface AnalysisWarningDiagnostic {
  text: string;
  affectsObservability: boolean;
}
```

- [x] **Step 2: Preserve the existing string API**

Keep `createAnalysisWarnings(messages): string[]` as a projection over the structured diagnostics so existing callers and warning text remain compatible.

- [x] **Step 3: Narrow the assessment input**

In `createReport()`, map all diagnostics into `report.warnings`, but pass only `affectsObservability` diagnostics to `createAssessment()`. Rename the assessment parameter to `observabilityWarnings` without changing thresholds or scoring.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/reporter.test.ts tests/assessment.test.ts`

Expected: both files pass, the report-only notice remains public, and genuine observability warnings retain their old effect.

### Task 3: Validate representative sessions and synchronize evidence

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Write generated validation artifacts only under: `tmp-real-validation/report-v2-audit/`

- [x] **Step 1: Regenerate the four representative reports read-only**

Hash each source before and after running the current CLI report command. Compare report aggregates without printing message content, local source paths, or session IDs.

- [x] **Step 2: Confirm the intended delta**

Expect top-level warnings, message counts, protected counts, remove/compress candidates, assessment risk dimensions, and compression decisions to remain unchanged. Only observability warning evidence and any directly derived observability score/status may change.

- [x] **Step 3: Record the behavior boundary**

Update the changelog and status document with the warning classification and representative validation result. Do not claim Phase 0 trust is locked.

### Task 4: Run completion gates

**Files:**
- Verify only

- [x] **Step 1: Run strict script TypeScript and focused regression tests**

Run the repository's strict `scripts/*.ts` TypeScript check and the focused report/assessment suites.

- [x] **Step 2: Run full tests and build**

Run: `npm test`

Run: `npm run build`

- [x] **Step 3: Run release-quality checks**

Run the packed/fresh-install smoke, `npm pack --dry-run --json --silent`, the temporary artifact residue scan, and `git diff --check`. Confirm the package contains exactly 22 files and preserve `.vscode/` untouched.

- [x] **Step 4: Self-review the implementation and plan**

Review the focused diff for warning order, public contract preservation, scorer/threshold/compression non-interference, unchecked plan items, placeholders, and accidental transcript or generated-artifact changes.

No commit is created because project instructions require explicit commit confirmation.
