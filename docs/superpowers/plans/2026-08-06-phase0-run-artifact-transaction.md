# Phase 0 Run Artifact Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not create commits or dispatch subagents in this workspace.

**Goal:** Preserve the previous `phase0-results.json` and `validation-summary.md` pair when either final Phase 0 run artifact cannot be committed.

**Architecture:** Extract the existing review-only two-artifact transaction into a generic script-scoped pair writer, then retain review and run-specific wrappers with fixed filenames and privacy-safe diagnostic labels. Per-sample CLI execution and report/trimmed outputs remain unchanged.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:fs/promises`.

---

### Task 1: Reproduce Mixed Phase 0 Run Evidence

**Files:**
- Modify: `tests/phase0-run-safety.test.ts`

- [ ] **Step 1: Write the failing process regression**

Import `lstat` and `writeFile`. Create one input fixture and an output directory containing `phase0-results.json` with `old-results\n` plus a directory named `validation-summary.md`. Run `scripts/phase0-run.ts` and assert:

```ts
expect(failure.code).not.toBe(0);
expect(failure.stderr).toContain("Phase 0 run artifact target must be a regular file");
expect(await readFile(join(outputDir, "phase0-results.json"), "utf8")).toBe("old-results\n");
expect((await lstat(join(outputDir, "validation-summary.md"))).isDirectory()).toBe(true);
expect(await sha256(inputFile)).toBe(beforeHash);
expect(await transactionArtifacts(outputDir)).toEqual([]);
```

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
npx vitest run tests/phase0-run-safety.test.ts --testNamePattern="preserves existing final evidence" --testTimeout=30000
```

Expected: FAIL because the current first `writeFile()` replaces `old-results\n` before the second target fails.

### Task 2: Extract the Generic Pair Transaction

**Files:**
- Create: `scripts/phase0-artifact-output.ts`
- Modify: `scripts/phase0-review-output.ts`
- Test: `tests/phase0-review-output-failure.test.ts`

- [ ] **Step 1: Define the generic contract**

```ts
export type Phase0ArtifactKind = "review" | "run";

export interface Phase0TextArtifact {
  fileName: string;
  data: string;
}

export async function writePhase0ArtifactPair(
  kind: Phase0ArtifactKind,
  outDir: string,
  artifacts: readonly [Phase0TextArtifact, Phase0TextArtifact]
): Promise<void>;
```

- [ ] **Step 2: Move the existing transaction internals without semantic changes**

Construct each target with `join(outDir, artifact.fileName)`. Preserve exclusive same-directory stages, ENOENT-only target detection, regular-file validation, backup/rename commit, reverse rollback, complete cleanup attempts, recursive error flattening, and recovery artifact retention. Build diagnostics from the controlled kind:

```ts
const artifactDescription = `Phase 0 ${kind} artifact`;
const artifactsDescription = `Phase 0 ${kind} artifacts`;
```

Use those strings for stage, target, restore, backup cleanup, and stage cleanup errors so existing review messages remain byte-compatible.

- [ ] **Step 3: Keep the review wrapper stable**

Replace `scripts/phase0-review-output.ts` with:

```ts
import { writePhase0ArtifactPair } from "./phase0-artifact-output.js";

export async function writePhase0ReviewArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void> {
  await writePhase0ArtifactPair("review", outDir, [
    { fileName: "phase0-review.json", data: json },
    { fileName: "phase0-review.md", data: markdown }
  ]);
}
```

- [ ] **Step 4: Verify extraction stays GREEN**

Run:

```bash
npx vitest run tests/phase0-review-output-failure.test.ts tests/phase0-review.test.ts --testTimeout=30000
```

Expected: all existing review transaction and process tests pass.

### Task 3: Wire Phase 0 Run Final Artifacts

**Files:**
- Create: `scripts/phase0-run-output.ts`
- Modify: `scripts/phase0-run.ts`
- Test: `tests/phase0-run-safety.test.ts`

- [ ] **Step 1: Add the run wrapper**

```ts
import { writePhase0ArtifactPair } from "./phase0-artifact-output.js";

export async function writePhase0RunArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void> {
  await writePhase0ArtifactPair("run", outDir, [
    { fileName: "phase0-results.json", data: json },
    { fileName: "validation-summary.md", data: markdown }
  ]);
}
```

- [ ] **Step 2: Replace sequential writes**

In `phase0-run.ts`, remove the `writeFile` import, import `writePhase0RunArtifacts`, construct both complete strings, and call:

```ts
const json = `${JSON.stringify(output, null, 2)}\n`;
const markdown = formatValidationSummary(output);
await writePhase0RunArtifacts(outputDir, json, markdown);
process.stdout.write(json);
```

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npx vitest run tests/phase0-run-safety.test.ts tests/phase0-run-plan.test.ts tests/phase0-summary.test.ts tests/phase0-review-output-failure.test.ts --testTimeout=30000
```

Expected: all tests pass, the old result body remains unchanged on the injected invalid summary target, and no `.stage` or `.bak` remains after recoverable failure.

### Task 4: Synchronize Audit Documentation

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Document the exact guarantee**

Record that the final run JSON/Markdown bodies are both staged before commit, recoverable second-target failures restore the old pair, rollback/cleanup failures expose all causes and retain recovery artifacts, and hard termination/concurrent writers still have no journal or lock.

- [ ] **Step 2: Preserve scope statements**

Explicitly state that per-sample report/trimmed output, result schema, scorer, threshold, compression, six-command surface, and original transcript read-only behavior are unchanged.

### Task 5: Complete Verification

**Files:**
- Modify: `docs/dev/status-and-next-steps.md` only if the actual test count changes.

- [ ] **Step 1: Run complete tests**

```bash
npm test
```

Expected: zero failures; record exact file and test counts.

- [ ] **Step 2: Build and verify the package**

```bash
npm run build
npm pack --dry-run --json --silent
```

Expected: build exits 0 and the publish manifest remains 22 files.

- [ ] **Step 3: Check repository hygiene**

```bash
git diff --check
```

Expected: exit 0 apart from existing line-ending warnings. Confirm there are no `.tgz`, `.stage`, or `.bak` residues and `.vscode/` remains untouched.
