# Phase 0 Compressed Artifact Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every successful Phase 0 compressed artifact to its exact SHA-256 and reject same-name byte drift during review.

**Architecture:** Extend successful results v2 compress records with `output_sha256`, change the review-side compressed collection from an ID set to an ID/digest map, and compare both IDs and hashes. Preserve older valid v2 evidence as readable but not ready through `compressed_integrity_unavailable`; keep review artifacts aggregate-only.

**Tech Stack:** Node.js 20+, TypeScript, Vitest

---

### Task 1: Capture The Missing Identity Gate

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`

- [x] **Step 1: Add the runner digest regression**

Write a successful compressed artifact with a fixed UTF-8 body and assert:

```ts
expect(result.compress).toMatchObject({
  ok: true,
  output_sha256: createHash("sha256").update(compressedContents).digest("hex")
});
```

- [x] **Step 2: Add pure evidence regressions**

Extend the result fixture type and successful fixture with `output_sha256`. Build actual compressed evidence as `Map<string, string>`. Add three tests:

```ts
expect(evidence).toMatchObject({
  ready: false,
  passed: false,
  matched_compressed_artifacts: 5,
  matched_compressed_hashes: 4,
  issues: ["compressed_hash_mismatch"]
});
```

Delete one expected digest and require `compressed_integrity_unavailable`. Set one digest to a private invalid value and require `invalid_phase0_results` without serializing that value.

- [x] **Step 3: Add the review-process tamper regression**

Make `createReviewFixture()` write valid `output_sha256` values. Overwrite one same-name `.trimmed.jsonl` after fixture creation, run review, and assert `review_required`, five matched artifact IDs, four matched hashes, `compressed_hash_mismatch`, and no private sentinel/digest/path in JSON or Markdown.

- [x] **Step 4: Verify RED**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/phase0-run-sample.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts
```

Expected: the runner lacks `output_sha256`; evidence ignores digest values and missing/malformed digests; review does not detect same-name replacement.

### Task 2: Record Exact Compressed Bytes

**Files:**
- Modify: `scripts/phase0-run-sample.ts`

- [x] **Step 1: Extend the result type**

Change the compress result shape to:

```ts
compress: Phase0CommandResult & {
  output_file: string;
  output_sha256?: string;
};
```

- [x] **Step 2: Return validation evidence**

Change `validateCompressedArtifact()` to return `{ result, sha256? }`. After the existing successful regular-file check, read the artifact Buffer and return:

```ts
return {
  result,
  sha256: createHash("sha256").update(contents).digest("hex")
};
```

Missing, non-regular, unreadable, or failed-process paths return no digest and preserve their existing error classification.

- [x] **Step 3: Store the digest**

Populate `compress.output_sha256` only when compressed validation returns a digest.

### Task 3: Compare Expected And Actual Digests

**Files:**
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: Normalize optional compatibility evidence**

Add `compressedSha256?: string` to `ValidationResult`. For successful compress results, accept an absent `output_sha256`, reject a present non-lowercase-SHA-256 value, and retain a valid value.

- [x] **Step 2: Compare maps without weakening set checks**

Change `loadPhase0ValidationEvidence()` to accept `ReadonlyMap<string, string>`. Derive the actual ID set from its keys, compute `matched_compressed_hashes`, and add deterministic issues:

```ts
if (expectedCompressedSha256.size !== expectedCompressedSet.size) {
  readinessIssues.push("compressed_integrity_unavailable");
}
if ([...expectedCompressedSha256].some(([id, expected]) => {
  const actual = actualCompressedArtifacts.get(id);
  return actual !== undefined && actual !== expected;
})) {
  readinessIssues.push("compressed_hash_mismatch");
}
```

Add `matched_compressed_hashes: 0` to empty evidence.

- [x] **Step 3: Hash review artifacts**

Change `loadReports()` to return `compressedArtifacts: Map<string, string>`. For every regular `.trimmed.jsonl`, read the Buffer; on success store its basename and SHA-256, and on failure omit it. Do not parse or expose the content.

- [x] **Step 4: Render the aggregate count**

Add this Markdown validation row:

```ts
lines.push(`| Compressed hashes matched | ${output.validation.matched_compressed_hashes}/${output.validation.expected_compressed_artifacts} |`);
```

- [x] **Step 5: Verify GREEN**

Run the three focused test files and require all tests to pass without warnings or errors.

### Task 4: Synchronize Contracts And Status

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document results and review fields**

State that new successful compress results v2 include `output_sha256`, old v2 without it remains review-required, and review exposes `matched_compressed_hashes` without digest values.

- [x] **Step 2: Preserve scope statements**

Replace the old “does not read/hash compressed content” limitation with the precise boundary: bytes are read only for SHA-256; JSONL syntax, source correspondence, and compression semantics remain unverified.

- [x] **Step 3: Record validation evidence**

Record sanitized fixture counts and tamper detection without paths, IDs, digests, or content.

### Task 5: Verify The Complete Change

- [x] **Step 1: Focused Phase 0 tests**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/phase0-run-sample.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-safety.test.ts
```

- [x] **Step 2: Strict script type-check**

Run the repository's established strict no-emit TypeScript command over Phase 0 scripts and tests.

- [x] **Step 3: Full quality gates**

Run:

```powershell
npm test
npm run build
npx vitest run --testTimeout=30000 tests/package-contents.test.ts
npm pack --dry-run --json --silent
git diff --check
```

Require all tests and build to pass, 22 package files, zero forbidden paths, no generated `.tgz`, and no temporary validation residue. Do not modify `.vscode/`, private reports, compressed artifacts, or original transcripts.

This plan is authorized for inline execution in the current worktree. Do not commit, push, create a PR, bump result/review schema versions, alter compression semantics, or change the six-command public surface.
