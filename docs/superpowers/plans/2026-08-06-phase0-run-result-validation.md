# Phase 0 Run Result Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Count analyze/report as successful only when their required JSON contracts are usable, while preserving batch evidence for contract failures.

**Architecture:** Move per-sample command execution, hashing, JSON validation, and result compaction into `phase0-run-sample.ts`. Validate process results and artifacts independently, preserve actual exit codes, and return the existing Phase 0 result schema to the batch orchestrator.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, real child processes and temporary files.

---

### Task 1: Reproduce Report Artifact Contract Failures

**Files:**
- Modify: `tests/phase0-run-safety.test.ts`

- [x] **Step 1: Add a general process runner**

Return `{ code, stdout, stderr }` for both success and failure without asserting the expected exit status. Keep `runPhase0ExpectFailure()` as a wrapper for existing tests.

```ts
async function runPhase0(inputDir: string, outputDir: string): Promise<{
  code: number | string | undefined;
  stdout: string;
  stderr: string;
}>;
```

- [x] **Step 2: Add a real-file mutation helper**

Poll with `access()` and `delay(5)` until the report exists, then execute a provided write/remove callback. Fail after 20 seconds rather than silently skipping the mutation.

```ts
async function mutateWhenCreated(file: string, mutate: () => Promise<void>): Promise<void>;
```

- [x] **Step 3: Add the invalid-report regression**

Start `phase0-run` on one copied OpenAI fixture and concurrently replace `<sample>.report.json` with malformed JSON containing a private sentinel. Assert the runner exits zero, writes final evidence, preserves analyze/compress success and input hash, records `report.ok=false` with exit code zero, uses analyze metadata, and does not copy the sentinel into results.

- [x] **Step 4: Add the missing-report regression**

Run the same real process while removing the report after creation. Assert `aggregate.report_ok === 0`, the sample is failed, the report error is `Report artifact was not created: <path>`, analyze metadata remains present, and the input hash is unchanged.

- [x] **Step 5: Verify RED**

Run:

```bash
npx vitest run tests/phase0-run-safety.test.ts --testNamePattern="report artifact" --testTimeout=30000
```

Expected: invalid JSON aborts the current batch, while a missing artifact is incorrectly counted as `report_ok`.

### Task 2: Extract And Validate Per-Sample Results

**Files:**
- Create: `scripts/phase0-run-sample.ts`
- Modify: `scripts/phase0-run.ts`
- Test: `tests/phase0-run-safety.test.ts`

- [x] **Step 1: Move existing result types and command execution**

Export `Phase0CommandResult`, `Phase0SampleResult`, `Phase0CliRunner`, `validatePhase0Sample()`, and `isPhase0SampleOk()`. Preserve command order, timeout, `maxBuffer`, input hashing, error truncation, and omission of stdout from stored results.

```ts
export type Phase0CliRunner = (
  args: string[],
  timeoutMs: number
) => Promise<Phase0CommandResult>;

export async function validatePhase0Sample(
  samplePlan: Phase0SamplePlan,
  timeoutMs: number,
  runCli: Phase0CliRunner = runPhase0Cli
): Promise<Phase0SampleResult>;
```

- [x] **Step 2: Add stable report artifact validation**

For a successful report process, use `stat()` with ENOENT-only classification, require a regular file, read UTF-8, parse JSON, and require a non-array object. Convert each contract failure with:

```ts
function contractFailure(
  result: Phase0CommandResult,
  error: string
): Phase0CommandResult {
  return { ...result, ok: false, error };
}
```

Do not inspect a report artifact when the report process failed. Use valid analyze JSON as metadata fallback without changing `report.ok=false`.

- [x] **Step 3: Update batch orchestration imports**

Remove child-process, hash, report-read, compaction, and sample-validation code from `phase0-run.ts`. Import the new types and functions, call `validatePhase0Sample()`, and use `isPhase0SampleOk()` for `failed_samples`. Keep aggregation and final artifact formatting unchanged.

- [x] **Step 4: Verify GREEN for real-process regressions**

Run:

```bash
npx vitest run tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts --testTimeout=30000
```

Expected: both report artifact regressions and all prior Phase 0 run tests pass.

### Task 3: Validate Analyze JSON Independently

**Files:**
- Create: `tests/phase0-run-sample.test.ts`
- Modify: `scripts/phase0-run-sample.ts`

- [x] **Step 1: Write the failing injected-runner test**

Use a real temporary input file and an injected runner that returns malformed private analyze stdout, writes a complete valid report object for the report command, and returns success for compress. Assert:

```ts
expect(result.analyze).toMatchObject({
  ok: false,
  exit_code: 0,
  error: "Analyze command returned invalid JSON report"
});
expect(result.report.ok).toBe(true);
expect(result.source).toBe("openai-jsonl");
expect(JSON.stringify(result)).not.toContain(privateSentinel);
```

The test double replaces only the external CLI process and reproduces its complete `Phase0CommandResult`; hashing and report filesystem behavior remain real.

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/phase0-run-sample.test.ts --testTimeout=30000
```

Expected: FAIL because the first implementation parses analyze JSON only as a report fallback.

- [x] **Step 3: Parse successful analyze output unconditionally**

Return `Analyze command returned no JSON report` for absent/blank stdout and `Analyze command returned invalid JSON report` for syntax errors or non-object JSON. Parse report and analyze independently, then choose `validReport ?? validAnalyze` only for optional metadata.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run tests/phase0-run-sample.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts --testTimeout=30000
```

Expected: all tests pass and private malformed content is absent from stored results.

### Task 4: Synchronize Documentation

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Document command-contract semantics**

State that analyze/report success requires usable JSON/output contracts, a zero child exit can coexist with stored `ok=false`, and invalid artifacts are recorded per sample without aborting final evidence.

- [x] **Step 2: Document privacy and compatibility**

State that fixed errors do not echo stdout or report content, while successful output, result schema, execution order, gates, scorer, threshold, compression, six commands, and transcript read-only behavior are unchanged.

### Task 5: Complete Verification

**Files:**
- Modify: `docs/dev/status-and-next-steps.md` only after reading the actual complete test count.

- [x] **Step 1: Strictly type-check script modules**

Run TypeScript over `phase0-run.ts`, `phase0-run-sample.ts`, planning/output helpers, and shared dependencies with NodeNext, ES2022, strict mode, and Node types.

- [x] **Step 2: Run complete quality gates**

```bash
npm test
npm run build
npm pack --dry-run --json --silent
git diff --check
```

Expected: zero test/build/diff failures, packed/fresh-install smoke green, and the package manifest remains 22 files.

- [x] **Step 3: Check workspace hygiene**

Confirm no `.tgz`, `.stage`, or `.bak` files remain, `.vscode/` is untouched, and no unrelated user changes were reverted.
