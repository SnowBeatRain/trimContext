# Phase 0 Compressed Semantic Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require Phase 0 compressed artifacts to be source-adapter-readable and to contain exactly the report messages not marked `remove_candidate`.

**Architecture:** Add one script-scoped validator that converts report messages and re-parsed compressed messages into stable identity multisets. Invoke it from per-sample batch validation for early failure and from review artifact loading for independent aggregate evidence; keep all identities and parser details private.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, existing trimctx JSONL adapters

---

### Task 1: Capture The Shared Semantic Contract

**Files:**
- Create: `tests/phase0-compressed-validation.test.ts`
- Create: `scripts/phase0-compressed-validation.ts`

- [x] **Step 1: Write source-family success tests**

For each sanitized Claude Code, OpenAI, and Codex fixture, run `compressFile()` into a temporary output, read the generated report and compressed bytes, and assert the wished-for validator result:

```ts
expect(validatePhase0CompressedArtifact(
  compressed,
  output,
  result.report.input.source,
  result.report.messages
)).toMatchObject({ status: "matched" });
```

- [x] **Step 2: Write identity and error tests**

Cover duplicate message counts, OpenAI batch reindexing, parser-ignored Codex metadata, empty expected/output sets, malformed JSONL, a valid JSONL extra retained message, a missing retained message, a remaining `remove_candidate`, and invalid report identity fields. Assert only fixed statuses and aggregate counts; assert private sentinels are absent from the serialized result.

- [x] **Step 3: Run the new test file and verify RED**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/phase0-compressed-validation.test.ts
```

Expected: FAIL because `scripts/phase0-compressed-validation.ts` and `validatePhase0CompressedArtifact()` do not exist.

- [x] **Step 4: Implement the minimal shared validator**

Create the fixed result union and source-specific parser dispatch. Validate report identities, filter out `remove_candidate`, fingerprint `source/role/content/timestamp/sessionId`, count duplicates, catch parser failures, and compare maps without returning fingerprints or errors.

- [x] **Step 5: Run the new tests and verify GREEN**

Run the same Vitest command and require every test to pass.

### Task 2: Fail Invalid Batch Artifacts Early

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Modify: `scripts/phase0-run-sample.ts`

- [x] **Step 1: Write runner RED tests**

Add separate cases where a zero-exit compress process writes malformed JSONL and valid JSONL whose normalized multiset differs from a valid report. Require:

```ts
expect(result.compress).toMatchObject({
  ok: false,
  exit_code: 0,
  error: expect.stringContaining("Compressed artifact")
});
expect(result.compress).not.toHaveProperty("output_sha256");
```

Also make the success digest fixture's report messages match its compressed body.

- [x] **Step 2: Run runner tests and verify RED**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/phase0-run-sample.test.ts
```

Expected: malformed and semantically drifting artifacts still retain `compress.ok: true`.

- [x] **Step 3: Integrate the shared validator**

Pass the valid report artifact into compressed validation. Apply fixed errors for `invalid_structure`, `message_set_mismatch`, and `reference_unavailable`; record the existing SHA-256 only for `matched`. When the report artifact is unavailable, retain the existing independent compressed file/hash result and rely on the already-failed report plus review's unavailable gate.

- [x] **Step 4: Run runner and shared tests and verify GREEN**

Run both focused test files and require all tests to pass.

### Task 3: Add Independent Review Evidence

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: Write pure evidence RED tests**

Change the actual compressed map fixture to values containing `sha256` and a validation result. Add one test per non-matched status and require additive aggregate fields and fixed issues:

```ts
expect(evidence).toMatchObject({
  structurally_valid_compressed_artifacts: 5,
  matched_compressed_message_sets: 4,
  issues: ["compressed_message_set_mismatch"]
});
```

For invalid structure require 4/5 structures and 4/5 sets. For unavailable reference require the fixed unavailable issue. Keep artifact ID and hash counts at 5/5.

- [x] **Step 2: Write review-process RED tests**

Update complete fixtures so report messages have valid identity fields and each source's compressed body contains exactly the retained messages. Then create two independent defects while updating private results to the current digest: malformed JSONL and valid-JSON message-set drift. Require `review_required`, the new counts/issues, and absence of private sentinels, paths, IDs, digests, and parser text from JSON/Markdown.

- [x] **Step 3: Run evidence/review tests and verify RED**

Run:

```powershell
npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts
```

Expected: compressed evidence has no semantic status, counts, or readiness issues.

- [x] **Step 4: Extend evidence types and readiness rules**

Add `Phase0CompressedArtifact`, `structurally_valid_compressed_artifacts`, and `matched_compressed_message_sets`. Preserve independent set/hash checks, then add deterministic `compressed_structure_invalid`, `compressed_message_set_mismatch`, and `compressed_validation_unavailable` issues only for expected successful artifacts.

- [x] **Step 5: Revalidate during report loading**

Retain report messages privately on the loaded report artifact. Read each compressed artifact once as a Buffer, compute its hash, invoke the shared validator against the same-name report, and store only the hash plus fixed validation result. Do not retain the Buffer or expose source content.

- [x] **Step 6: Render aggregate Markdown rows**

Add:

```ts
lines.push(`| Compressed structures valid | ${output.validation.structurally_valid_compressed_artifacts}/${output.validation.expected_compressed_artifacts} |`);
lines.push(`| Compressed message sets matched | ${output.validation.matched_compressed_message_sets}/${output.validation.expected_compressed_artifacts} |`);
```

- [x] **Step 7: Run shared, runner, evidence, and review tests and verify GREEN**

Run all four focused test files and require no failures or warnings.

### Task 4: Synchronize Phase 0 Contracts

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document the runner gate**

State that a valid report reference causes successful compressed bytes to be adapter-parsed and compared with the report's retained-message multiset before `compress.ok` remains true. Document the fixed privacy boundary and the behavior when the report command itself is invalid.

- [x] **Step 2: Document review evidence and compatibility**

Replace the old limitation that review does not validate syntax or semantics. Document the two aggregate fields, three issue codes, multiset identity fields, parser-ignored metadata boundary, and unchanged results/review schema versions.

- [x] **Step 3: Preserve trust language**

State explicitly that this is structural and decision-correspondence evidence, not proof of scorer correctness, candidate safety, byte-for-byte retention, or a locked Phase 0 trust state.

### Task 5: Verify The Complete Change

- [x] **Step 1: Run focused Phase 0 tests**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-compressed-validation.test.ts tests/phase0-run-sample.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts
```

- [x] **Step 2: Run strict TypeScript checks for scripts and production build**

Use the repository's established strict no-emit script command, then run `npm run build`.

- [x] **Step 3: Run the full suite and release gates**

```powershell
npm test
npx vitest run --testTimeout=30000 tests/package-contents.test.ts
npm pack --dry-run --json --silent
git diff --check
```

Require zero test/build failures, 22 expected package files, zero forbidden paths, no generated `.tgz`, and no temporary validation residue.

- [x] **Step 4: Run sanitized real Phase 0 validation**

Use copies under `tmp-real-validation/` only. Confirm every successful artifact is structurally valid and message-set matched, then create separate malformed and valid-JSON semantic drifts with current private digests and confirm the unique fixed issue for each. Clean only the temporary directory created for this task; keep existing `tmp-real-validation/report-v2-audit` untouched.

- [x] **Step 5: Recheck scope and worktree hygiene**

Confirm no scorer, threshold, safety, candidate decision, compression algorithm, Report v2, six-command surface, `.vscode/`, private report, compressed product artifact, or original transcript changed.

This plan is authorized for inline execution in the current dirty worktree. Do not commit, push, create a PR, spawn subagents, alter schema versions, or touch `.vscode/`.
