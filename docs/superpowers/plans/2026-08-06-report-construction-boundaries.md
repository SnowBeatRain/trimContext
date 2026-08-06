# Report Construction Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while executing this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate report evidence, finding, and review construction from the `createReport()` orchestration facade without changing Report v2 output or safety behavior.

**Architecture:** Introduce a pure evidence helper, a signal-oriented findings constructor, and a human-review constructor. Keep normalization, assessment/resume coordination, diagnostics, warnings, and final object assembly in `src/core/reporter.ts`.

**Tech Stack:** Node.js 20+, TypeScript, vitest.

---

### Task 1: Extract Evidence Normalization

**Files:**
- Create: `src/core/report-evidence.ts`
- Create: `tests/report-construction-boundaries.test.ts`

- [x] **Step 1: Add failing direct-import tests**

Create a focused test file that imports the intended standalone API and verifies both shape conversion and confidence ordering:

```ts
import { describe, expect, test } from "vitest";
import {
  confidenceRank,
  highestConfidence,
  toEvidenceRef
} from "../src/core/report-evidence.js";

describe("report evidence construction", () => {
  test("normalizes evidence without leaking detector details", () => {
    expect(toEvidenceRef({
      code: "exact_duplicate",
      confidence: "high",
      message_id: "m2",
      source_line: 2,
      role: "assistant",
      related_message_id: "m1",
      related_source_line: 1,
      details: { similarity: 1 }
    })).toEqual({
      message_id: "m2",
      source_line: 2,
      role: "assistant",
      code: "exact_duplicate",
      confidence: "high",
      related_message_id: "m1"
    });
  });

  test("orders confidence and retains the empty fallback", () => {
    expect(["low", "high", "medium"].map(value => confidenceRank(value))).toEqual([1, 3, 2]);
    expect(highestConfidence(["low", "high", "medium"])).toBe("high");
    expect(highestConfidence([])).toBe("medium");
  });
});
```

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/report-construction-boundaries.test.ts`

Expected: FAIL because `src/core/report-evidence.ts` does not exist.

- [x] **Step 3: Add the pure evidence module**

Create these exact exports using the existing reporter implementations:

```ts
export function toEvidenceRef(
  item: AnalyzedMessage["analysis"]["evidence"][number]
): FindingEvidenceRef;

export function highestConfidence(
  values: FindingEvidenceRef["confidence"][]
): FindingEvidenceRef["confidence"];

export function confidenceRank(
  value: FindingEvidenceRef["confidence"]
): number;
```

Keep conditional `related_message_id`, high/medium/low ranks `3/2/1`, and the existing `medium` empty fallback. Do not mutate the caller's confidence array while selecting the maximum.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/report-construction-boundaries.test.ts`

Expected: both evidence tests pass.

### Task 2: Extract Candidate Groups And Findings

**Files:**
- Create: `src/core/report-findings.ts`
- Modify: `tests/report-construction-boundaries.test.ts`

- [x] **Step 1: Add failing constructor tests**

Add direct imports and construct analyzed messages with explicit IDs, source lines, tokens, decisions, and evidence:

```ts
import {
  createCandidateGroups,
  createFindings
} from "../src/core/report-findings.js";

test("builds stable groups and aggregates findings by signal code", () => {
  const messages = [
    analyzedMessage("m1", 1, "remove_candidate", "exact_duplicate", "m4", "high", 10),
    analyzedMessage("m2", 2, "keep", "exact_duplicate", "m5", "medium", 20),
    analyzedMessage("m3", 3, "compress_candidate", "obsolete_tool_output", undefined, "medium", 30),
    analyzedMessage("m4", 4, "keep", undefined, undefined, undefined, 40),
    analyzedMessage("m5", 5, "keep", undefined, undefined, undefined, 50)
  ];
  const groups = createCandidateGroups(messages);
  const findings = createFindings(groups, ["sample_too_short"], messages);

  expect(groups.map(group => group.id)).toEqual([
    "exact_duplicate:m4",
    "exact_duplicate:m5",
    "obsolete_tool_output:none"
  ]);
  expect(groups[0]).toMatchObject({
    canonical_message_id: "m4",
    member_message_ids: ["m1"],
    tokens: 10
  });
  expect(findings.map(finding => finding.code)).toEqual([
    "exact_duplicate",
    "obsolete_tool_output",
    "sample_too_short"
  ]);
  expect(findings[0]).toMatchObject({
    severity: "critical",
    confidence: "high",
    impact: { message_count: 2, tokens: 30, token_ratio: 0.2 }
  });
});
```

Add a second case with duplicate evidence relationships at different confidence values and assert only the highest-confidence relationship remains.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/report-construction-boundaries.test.ts`

Expected: FAIL because `src/core/report-findings.ts` does not exist.

- [x] **Step 3: Move signal construction into the new module**

Export the existing signatures:

```ts
export function createCandidateGroups(messages: AnalyzedMessage[]): CandidateGroup[];

export function createFindings(
  groups: CandidateGroup[],
  limitations: string[],
  messages: AnalyzedMessage[]
): Finding[];
```

Move the supported-code map plus private group/evidence/finding comparators, decision-based severity, suggested action, title case, and four-decimal ratio helpers. Import `ASSESSMENT_THRESHOLDS` and the shared evidence helpers. Preserve canonical lookup, relationship keys, member ordering, evidence deduplication, limitation findings, and final sorting exactly.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/report-construction-boundaries.test.ts tests/reporter.test.ts`

Expected: focused construction tests and the existing facade tests pass.

### Task 3: Extract Review Queue And Recommendations

**Files:**
- Create: `src/core/report-review.ts`
- Modify: `tests/report-construction-boundaries.test.ts`

- [x] **Step 1: Add failing review tests**

Add direct imports and cover ordering, summary redaction, remove-candidate invariants, and recommendation activation:

```ts
import {
  createRecommendations,
  createReviewQueue
} from "../src/core/report-review.js";

test("builds a risk-ranked redacted review queue", () => {
  const removable = analyzedMessage(
    "m2", 2, "remove_candidate", "exact_duplicate", "m9", "high", 20
  );
  removable.content = "contact me@example.com with ghp_1234567890abcdef";
  const compressible = analyzedMessage(
    "m1", 1, "compress_candidate", "obsolete_tool_output", undefined, "medium", 40
  );

  const queue = createReviewQueue([compressible, removable]);

  expect(queue.map(item => item.message_id)).toEqual(["m2", "m1"]);
  expect(queue[0]).toMatchObject({
    risk: "high",
    default_action: "remove_after_review"
  });
  expect(queue[0]?.summary).toBe("contact [REDACTED_EMAIL] with [REDACTED]");
});

test("rejects invalid remove candidates through the standalone constructor", () => {
  const invalid = analyzedMessage(
    "m1", 1, "remove_candidate", "similar_duplicate", "m2", "medium", 10
  );
  expect(() => createReviewQueue([invalid])).toThrow(/high-confidence decisive evidence/i);
});

test("constructs unchanged recommendations and quoted commands", () => {
  expect(createRecommendations("C:\\work folder\\a.jsonl", "degraded", "ready", 1)).toEqual([
    {
      code: "new_chat",
      priority: 3,
      summary: "Prepare a reviewed continuation package for a new chat.",
      command: "trimctx new-chat \"C:\\work folder\\a.jsonl\""
    },
    {
      code: "review_then_compress",
      priority: 4,
      summary: "Review remove candidates before writing a compressed copy.",
      command: "trimctx compress \"C:\\work folder\\a.jsonl\" -o trimmed.jsonl"
    }
  ]);
});
```

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/report-construction-boundaries.test.ts`

Expected: FAIL because `src/core/report-review.ts` does not exist.

- [x] **Step 3: Move review construction into the new module**

Export the existing signatures:

```ts
export function createReviewQueue(messages: AnalyzedMessage[]): ReviewQueueItem[];

export function createRecommendations(
  file: string,
  health: AnalysisReport["assessment"]["status"],
  readiness: AnalysisReport["resume"]["readiness"]["level"],
  removeCount: number
): Recommendation[];
```

Move the decisive-code allowlist and private risk ranking, redaction, truncation, and path quoting helpers. Preserve validation order and error text, selection criteria, sorting tie-breakers, default actions, recommendation priorities, and commands.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/report-construction-boundaries.test.ts tests/reporter.test.ts`

Expected: direct review tests and facade tests pass.

### Task 4: Reduce Reporter To Orchestration

**Files:**
- Modify: `src/core/reporter.ts`
- Modify: `tests/report-construction-boundaries.test.ts`

- [x] **Step 1: Add facade depth-equivalence assertions**

Build a report from the shared analyzed-message fixture and compare its nested constructor-owned fields with direct module output:

```ts
const report = createReport(messages, "session.jsonl");
const groups = createCandidateGroups(report.messages);

expect(report.candidate_groups).toEqual(groups);
expect(report.findings).toEqual(
  createFindings(groups, report.assessment.limitations, report.messages)
);
expect(report.review_queue.items).toEqual(createReviewQueue(report.messages));
expect(report.recommendations).toEqual(createRecommendations(
  "session.jsonl",
  report.assessment.status,
  report.resume.readiness.level,
  report.remove_candidates.length
));
```

- [x] **Step 2: Verify the facade assertions pass before deletion**

Run: `npx vitest run tests/report-construction-boundaries.test.ts tests/reporter.test.ts`

Expected: PASS against the still-duplicated reporter implementation, proving the standalone modules are depth-compatible.

- [x] **Step 3: Replace reporter-local constructors with imports**

Import:

```ts
import { createCandidateGroups, createFindings } from "./report-findings.js";
import { createRecommendations, createReviewQueue } from "./report-review.js";
```

Delete the moved maps, sets, constructors, and helpers from `reporter.ts`. Retain only `createReport()`, report summary/meta coordination, Phase 0 trust, parser diagnostics, warning detection, `toAnalyzedMessage()`, and its conservative default analysis context.

- [x] **Step 4: Verify the reduced facade**

Run: `npx vitest run tests/report-construction-boundaries.test.ts tests/reporter.test.ts tests/report-markdown.test.ts tests/fixture-regression.test.ts`

Expected: all focused report regressions pass with unchanged object depth and Markdown behavior.

### Task 5: Synchronize Evidence And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-report-construction-boundaries.md`

- [x] Record the evidence/findings/review split, direct boundary tests, unchanged facade/schema/safety behavior, and the next `commands/init.ts` boundary candidate.
- [x] Re-run the two recorded Codex samples and compare message/group/finding/assessment/Markdown-size summaries with the pre-refactor baselines.
- [x] Run `npm test` and confirm all tests pass.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json --silent` and inspect the package contents.
- [x] Run `git diff --check`, inspect the final diff, and preserve `.vscode/` untouched.

No worktree or commit is created because the current user instructions require changes to remain in the existing worktree and require explicit approval before committing.
