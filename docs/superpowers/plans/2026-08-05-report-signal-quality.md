# Report Signal Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent observability limitations from masking established risks and turn per-relation findings into concise, risk-ranked key findings.

**Architecture:** Keep analyzers, decisions, candidate groups, and review queues unchanged. Adjust assessment precedence in `assessment.ts`, aggregate findings by signal code in `reporter.ts`, and bound only the Markdown evidence display while retaining full JSON evidence.

**Tech Stack:** Node.js 20+, TypeScript, vitest.

---

### Task 1: Preserve established risk under limitations

**Files:**
- Modify: `tests/assessment.test.ts`
- Modify: `src/core/assessment.ts`

- [x] **Step 1: Add failing assessment tests**

Add cases where 90% protected coverage coexists with high token pressure or protected high-rot evidence:

```ts
const highPressure = Array.from({ length: 10 }, (_, index) =>
  message(`p${index}`, { protected: index < 9, tokens: 20_000 })
);
expect((await assess(highPressure)).status).toBe("degraded");
expect((await assess(highPressure)).confidence).toBe("medium");
expect((await assess(highPressure)).limitations).toContain("protected_coverage_too_high");
```

Retain a low-risk 90%-protected case that remains `unknown`.

- [x] **Step 2: Verify RED**

Run `npx vitest run tests/assessment.test.ts`. Expected: the established-risk case returns `unknown` before implementation.

- [x] **Step 3: Implement risk-first precedence**

Evaluate `degraded`, then `attention`, then `unknown`, then `healthy`. Use medium degraded confidence when limitations remain.

- [x] **Step 4: Verify GREEN**

Run `npx vitest run tests/assessment.test.ts`. Expected: all assessment tests pass.

### Task 2: Aggregate and rank key findings

**Files:**
- Modify: `tests/reporter.test.ts`
- Modify: `src/core/reporter.ts`

- [x] **Step 1: Add failing aggregation tests**

Create multiple `exact_duplicate` candidate groups with distinct canonical messages and assert:

```ts
const duplicateFindings = report.findings.filter(finding => finding.code === "exact_duplicate");
expect(duplicateFindings).toHaveLength(1);
expect(duplicateFindings[0]?.impact.message_count).toBe(2);
expect(duplicateFindings[0]?.impact.tokens).toBe(first.tokens + second.tokens);
```

Also assert high-confidence keep-only evidence is `info`, a remove-candidate member makes the aggregate `critical`, member tokens are counted once, and signal findings sort by severity before token impact.

- [x] **Step 2: Verify RED**

Run `npx vitest run tests/reporter.test.ts`. Expected: multiple per-group findings are returned and high-confidence keep evidence is incorrectly critical.

- [x] **Step 3: Implement code-level aggregation**

Pass analyzed messages into `createFindings()`. Aggregate groups by signal code, deduplicate member IDs/evidence, calculate unique token impact, derive severity from member decisions, and sort findings deterministically. Append limitation findings after signal findings.

- [x] **Step 4: Verify GREEN**

Run `npx vitest run tests/reporter.test.ts`. Expected: all reporter tests pass and candidate-group assertions remain unchanged.

### Task 3: Bound Markdown evidence display

**Files:**
- Modify: `tests/report-markdown.test.ts`
- Modify: `src/core/report-markdown.ts`

- [x] **Step 1: Add a failing evidence-bound test**

Give one finding seven evidence references and assert only five `message ... line ...` entries render, followed by `另有 2 条证据`.

- [x] **Step 2: Verify RED**

Run `npx vitest run tests/report-markdown.test.ts`. Expected: all seven evidence entries render and the omitted-count line is absent.

- [x] **Step 3: Implement the display bound**

Add `MAX_FINDING_EVIDENCE = 5`, render the first five deterministic references, and append the omitted count. Do not mutate the report or truncate JSON evidence.

- [x] **Step 4: Verify GREEN**

Run `npx vitest run tests/report-markdown.test.ts`. Expected: redaction/escaping tests and the new evidence-bound test pass.

### Task 4: Synchronize project evidence and verify

Before final synchronization, use the representative-session validation to remove duplicate Markdown review rows without changing the JSON queue:

- [x] Add a failing test proving protected items appear only in the protected Markdown table.
- [x] Partition Markdown review tables by `protected` and verify the targeted test passes.
- [x] Re-run representative Markdown reports and record the size reduction.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] Record that Report v2 now preserves negative evidence under limitations and aggregates key findings without changing candidate groups or compression.
- [x] Re-run aggregate-only analysis on representative Codex sessions and compare status/finding counts.
- [x] Run `npm test` and confirm all tests pass, including Windows packed-install smoke.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json --silent` and inspect the 22-file public package.
- [x] Run `git diff --check`, scan the plan for unchecked items, and preserve `.vscode/` untouched.

No commit is created because project instructions require explicit commit confirmation.
