# Phase 0 Analyze/Report Semantic Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every valid Phase 0 analyze/report pair to contain the same complete Report v2 semantics and bind historical analyze output to the current report artifact.

**Architecture:** Add one script-scoped canonical JSON fingerprint helper. The runner records a distinct per-sample comparison status and private analyze semantic digest; review fingerprints the current byte-bound report object and independently compares aggregate evidence without exposing digests or content.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, existing Phase 0 results/review v2 evidence pipeline

---

### Task 1: Define Canonical Report Semantics

**Files:**
- Create: `scripts/phase0-report-semantics.ts`
- Create: `tests/phase0-report-semantics.test.ts`

- [x] **Step 1: Write canonical-equivalence RED tests**

Cover complete nested objects whose keys appear in different orders, including non-ASCII keys, and require the same lowercase 64-character digest. Assert arrays retain order and nested string/number/boolean/null changes produce different digests.

```ts
expect(createPhase0ReportSemanticSha256({
  z: [1, { b: true, a: null }],
  a: "value"
})).toBe(createPhase0ReportSemanticSha256({
  a: "value",
  z: [1, { a: null, b: true }]
}));
```

- [x] **Step 2: Write unavailable-input RED tests**

Use `undefined`, `NaN`, `Infinity`, `BigInt`, functions, symbols, and a cyclic object. Require `undefined` without throwing or serializing runtime-only values.

- [x] **Step 3: Run the new tests and verify RED**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-report-semantics.test.ts
```

Expected: FAIL because the helper module does not exist.

- [x] **Step 4: Implement deterministic canonical hashing**

Export:

```ts
export function createPhase0ReportSemanticSha256(value: unknown): string | undefined;
```

Serialize JSON primitives directly, recursively serialize arrays in order, recursively serialize objects with `Object.keys(value).sort()` ordering, and track the active object stack to reject cycles. Reject non-finite numbers and unsupported runtime types. Hash only the canonical UTF-8 string with SHA-256 and return no canonical body.

- [x] **Step 5: Run the semantic helper tests and verify GREEN**

Run the same Vitest command and require all tests to pass.

### Task 2: Add The Runner Cross-Command Gate

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Modify: `tests/phase0-summary.test.ts`
- Modify: `scripts/phase0-run-sample.ts`
- Modify: `scripts/phase0-run.ts`

- [x] **Step 1: Write runner RED tests**

Add three cases:

1. Analyze and report objects differ only in object-key order: `matched`, a lowercase semantic digest is present, and the sample succeeds.
2. Both satisfy the minimum contract but one private nested report value differs: analyze/report command `ok` values stay true, `analyze_report.status` is `mismatch`, the semantic digest is present, and `isPhase0SampleOk()` is false.
3. Either analyze or report is invalid: status is `unavailable`, the digest is absent, and existing command failure behavior remains unchanged.

Assert serialized results do not contain the private changed field name or value beyond content that already belongs to the private report fixture itself; inspect only the compact returned evidence when applying the privacy assertion.

- [x] **Step 2: Write aggregate/summary RED tests**

Extend the process summary fixture to require:

```ts
aggregate: {
  analyze_report_matched: 1,
  failed_samples: []
}
```

Require the Markdown aggregate row `Analyze/report semantics matched | 1/1`. Add a mismatch fixture and require its sample in `failed_samples` even though both command counters remain successful.

- [x] **Step 3: Run runner tests and verify RED**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-run-sample.test.ts tests/phase0-summary.test.ts
```

Expected: FAIL because sample evidence and aggregate matching do not exist.

- [x] **Step 4: Implement per-sample evidence**

Add:

```ts
export type Phase0AnalyzeReportStatus = "matched" | "mismatch" | "unavailable";

export interface Phase0AnalyzeReportEvidence {
  status: Phase0AnalyzeReportStatus;
  analyze_semantic_sha256?: string;
}
```

After independent analyze/report validation, fingerprint both parsed objects. For a valid pair, retain the analyze digest and compare it with the report digest. For an invalid command or unavailable fingerprint, return only `status: "unavailable"`. Add `analyze_report` to `Phase0SampleResult` and require `matched` in `isPhase0SampleOk()` without changing either command's `ok` value.

- [x] **Step 5: Extend aggregate and Markdown output**

Add `aggregate.analyze_report_matched`, count only `status === "matched"`, and render:

```ts
lines.push(`| Analyze/report semantics matched | ${output.aggregate.analyze_report_matched}/${output.sample_count} |`);
```

- [x] **Step 6: Run runner/helper tests and verify GREEN**

Run both runner files plus `tests/phase0-report-semantics.test.ts` and require no failures.

### Task 3: Add Independent Review Evidence

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: Extend valid evidence fixtures**

Every fresh successful result must contain:

```ts
analyze_report: {
  status: "matched",
  analyze_semantic_sha256: semanticSha256(reportObject)
}
```

and aggregate `analyze_report_matched` must equal the matched result count. Extend actual report fixtures with `semanticSha256` computed by the shared helper.

- [x] **Step 2: Write pure evidence RED tests**

Require additive validation fields:

```ts
expected_analyze_report_pairs: 5,
matched_analyze_report_semantics: 5
```

Add separate tests for:

- batch `status: "mismatch"` with a valid digest;
- current report semantic digest drift while byte/source/input maps otherwise match the provided fixture;
- legacy results v2 with the new sample evidence and aggregate field absent;
- malformed present status/digest combinations;
- a failed command with explicit `unavailable`, excluded from the expected-pair denominator.

Require fixed `analyze_report_semantic_mismatch` and `analyze_report_semantic_validation_unavailable` issues, and keep malformed present evidence under `invalid_phase0_results`.

- [x] **Step 3: Write review-process RED tests**

Generate current report artifacts from valid objects, run review, and require all semantic pairs matched. Then change one private nested analyze digest in results while keeping valid lowercase digest shape and all report/compressed byte evidence current. Require `review_required`, 4/5 matched semantics, the unique semantic mismatch issue, and absence of the private sentinel, digest, report ID, and path from review JSON/Markdown.

- [x] **Step 4: Run evidence/review tests and verify RED**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts
```

Expected: FAIL because current review neither loads report semantic digests nor validates runner evidence.

- [x] **Step 5: Normalize compatible results evidence**

Extend `ValidationResult` with evidence presence, status, and analyze digest. A missing complete field is legacy/unavailable; a present field must obey these invariants:

- both commands successful: status is `matched` or `mismatch`, with a valid digest;
- either command unsuccessful: status is `unavailable`, without a digest;
- present malformed status/digest combinations invalidate results.

Validate `aggregate.analyze_report_matched` when present. Missing sample/aggregate evidence adds only the fixed unavailable issue so old results v2 can be read but cannot become ready. Recompute `failed_samples` with the semantic status when fresh evidence is present.

- [x] **Step 6: Compare current report semantics**

Add `semanticSha256?: string` to `Phase0ReportArtifact`. Build expected pairs from independently successful commands. Count a match only when batch status is `matched`, the recorded analyze digest exists, and it equals the same-name current report's semantic digest. Add fixed issues in deterministic order before source-coverage issues.

- [x] **Step 7: Fingerprint reports during review loading**

In `loadReports()`, parse each report Buffer once, then compute exact byte hash and semantic hash from the same parsed object. Retain neither canonical JSON nor report bytes after metrics and compressed validation are built.

- [x] **Step 8: Render aggregate review rows**

Add:

```ts
lines.push(`| Expected analyze/report pairs | ${output.validation.expected_analyze_report_pairs} |`);
lines.push(`| Analyze/report semantics matched | ${output.validation.matched_analyze_report_semantics}/${output.validation.expected_analyze_report_pairs} |`);
```

- [x] **Step 9: Run helper, runner, evidence, and review tests and verify GREEN**

Run all five focused test files and require no failures or warnings.

### Task 4: Synchronize Contracts

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document the complete semantic contract**

State that complete parsed Report v2 values must match, object-key/formatting differences are ignored, arrays remain ordered, and no Report v2 field is exempt.

- [x] **Step 2: Document runner/review evidence and compatibility**

Document `analyze_report`, `aggregate.analyze_report_matched`, both review metrics, both issue codes, legacy results v2 rerun behavior, private digest scope, and unchanged schema versions.

- [x] **Step 3: Preserve trust and behavior boundaries**

State that correspondence does not prove report correctness, scoring safety, candidate safety, or locked Phase 0 trust. Confirm no Report v2, scorer, threshold, protected, compression, six-command, or transcript write behavior changed.

### Task 5: Verify The Complete Change

- [x] **Step 1: Run focused Phase 0 tests**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-report-semantics.test.ts tests/phase0-run-sample.test.ts tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-safety.test.ts
```

- [x] **Step 2: Run strict TypeScript and production build**

Run strict NodeNext/ES2022 no-emit TypeScript over all `scripts/phase0-*.ts`, then run `npm run build`.

- [x] **Step 3: Run full and release gates**

```powershell
npm test
npx vitest run --testTimeout=30000 tests/package-contents.test.ts
npm pack --dry-run --json --silent
git diff --check
```

Require zero failures, 22 package files, zero generated `.tgz`, and no stage/backup/tamper residue.

- [x] **Step 4: Run sanitized real-chain and controlled drift validation**

Use copies under a task-specific `tmp-real-validation/` directory. Require 6/6 analyze/report semantic matches, all source hashes unchanged, and zero validation issues with empty labels still producing `review_required`. Then change one private analyze semantic digest to a valid digest while keeping report byte evidence current; require 5/6 matches and the unique `analyze_report_semantic_mismatch` issue.

- [x] **Step 5: Clean and audit scope**

Remove only this task's temporary directory. Keep `tmp-real-validation/report-v2-audit`, `.vscode/`, existing private reports, product compressed artifacts, and original transcripts untouched. Confirm scorer, thresholds, safety, candidate decisions, compression, Report v2, and the six public commands did not change.

This plan is authorized for inline execution in the current dirty `main` worktree. Do not commit, push, create a PR, spawn subagents, alter schema version strings, or touch `.vscode/`.
