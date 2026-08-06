# Hook CLAUDE.md Concurrent Write Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create a worktree or commits in this working tree.

**Goal:** Make Claude Stop hook `CLAUDE.md` updates fail closed when the target bytes changed after the hook read them.

**Architecture:** Add an exact-byte conditional sibling to the shared atomic writer, with checks before staging and immediately before commit. Make hook storage return one string/raw-byte snapshot and require that snapshot for writes, while keeping `runHook()` responsible for analysis and the existing pure managed-block transform.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:fs/promises`, existing same-directory atomic replacement helper.

---

### Task 1: Add Exact-Byte Conditional Atomic Writes

**Files:**
- Modify: `tests/platform-files.test.ts`
- Modify: `tests/platform-files-failure.test.ts`
- Modify: `src/platform/files.ts`

- [x] **Step 1: Write failing real-filesystem comparison tests**

Import `rm` and `atomicWriteFileIfUnchanged` in `tests/platform-files.test.ts` and add separate tests for a matching existing snapshot, changed bytes, deletion, and missing-to-created conflict:

```ts
test("atomically replaces a target whose bytes still match the expected snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
  const output = join(dir, "CLAUDE.md");
  const expected = Buffer.from("old instructions\n");
  await writeFile(output, expected);

  await atomicWriteFileIfUnchanged(output, "new instructions\n", expected, "target changed");

  expect(await readFile(output, "utf8")).toBe("new instructions\n");
  expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});

test("preserves changed target bytes when conditional atomic replacement conflicts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
  const output = join(dir, "CLAUDE.md");
  const expected = Buffer.from("old instructions\n");
  await writeFile(output, "concurrent instructions\n", "utf8");

  await expect(atomicWriteFileIfUnchanged(
    output,
    "new instructions\n",
    expected,
    "target changed"
  )).rejects.toThrow("target changed");

  expect(await readFile(output, "utf8")).toBe("concurrent instructions\n");
  expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});

test("does not recreate a conditional target deleted after its snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
  const output = join(dir, "CLAUDE.md");
  const expected = Buffer.from("deleted instructions\n");
  await writeFile(output, expected);
  await rm(output);

  await expect(atomicWriteFileIfUnchanged(
    output,
    "new instructions\n",
    expected,
    "target changed"
  )).rejects.toThrow("target changed");

  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});

test("preserves a target created after an absent snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
  const output = join(dir, "CLAUDE.md");
  await writeFile(output, "concurrent instructions\n", "utf8");

  await expect(atomicWriteFileIfUnchanged(
    output,
    "new instructions\n",
    undefined,
    "target changed"
  )).rejects.toThrow("target changed");

  expect(await readFile(output, "utf8")).toBe("concurrent instructions\n");
  expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});
```

In `tests/platform-files-failure.test.ts`, import the new operation and inject a
target edit from the temporary handle's write so the initial comparison passes
but the pre-commit comparison must fail:

```ts
test("preserves target bytes changed while a conditional temp file is staged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-staging-"));
  const output = join(dir, "CLAUDE.md");
  const expected = Buffer.from("old instructions\n");
  await writeFile(output, expected);
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
    const handle = await actualFs.open(path, flags, mode);
    const write = handle.writeFile.bind(handle);
    Object.defineProperty(handle, "writeFile", {
      configurable: true,
      value: async (...args: Parameters<FileHandle["writeFile"]>) => {
        await write(...args);
        await actualFs.writeFile(output, "concurrent instructions\n", "utf8");
      }
    });
    return handle;
  });

  try {
    await expect(atomicWriteFileIfUnchanged(
      output,
      "new instructions\n",
      expected,
      "target changed"
    )).rejects.toThrow("target changed");

    expect(await actualFs.readFile(output, "utf8")).toBe("concurrent instructions\n");
    expect((await actualFs.readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  } finally {
    vi.mocked(open).mockImplementation(actualFs.open);
    await actualFs.rm(dir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: Run the platform tests and confirm RED**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: FAIL because `atomicWriteFileIfUnchanged` is not exported. The
staging-time edit test must also fail rather than being skipped.

- [x] **Step 3: Implement the minimal byte comparison boundary**

Add `readFile` to the `node:fs/promises` import and add:

```ts
export async function atomicWriteFileIfUnchanged(
  outputFile: string,
  data: string,
  expectedContent: Uint8Array | undefined,
  conflictMessage = "Output file changed while update was being prepared"
): Promise<void> {
  const snapshot = expectedContent === undefined ? undefined : Buffer.from(expectedContent);
  const assertUnchanged = async (): Promise<void> => {
    await assertFileContentUnchanged(outputFile, snapshot, conflictMessage);
  };
  await assertUnchanged();
  await writeAtomicFile(outputFile, data, assertUnchanged);
}

async function assertFileContentUnchanged(
  file: string,
  expectedContent: Buffer | undefined,
  conflictMessage: string
): Promise<void> {
  let currentContent: Buffer;
  try {
    currentContent = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (expectedContent === undefined) return;
      throw new Error(conflictMessage);
    }
    throw error;
  }
  if (expectedContent === undefined || !currentContent.equals(expectedContent)) {
    throw new Error(conflictMessage);
  }
}
```

Do not change `atomicWriteFile()` or `atomicWriteFileDistinctFromInput()` behavior.

- [x] **Step 4: Run the platform tests and confirm GREEN**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: all tests pass; conflict cases preserve targets and leave no trimctx temp files.

### Task 2: Recheck Before Windows Fallback Replacement

**Files:**
- Modify: `tests/platform-files-failure.test.ts`
- Modify: `src/platform/files.ts`

- [x] **Step 1: Write the failing Windows fallback race test**

Import `atomicWriteFileIfUnchanged` and add this Windows-only test. The injected first rename changes the target to B before returning the replacement signal:

```ts
test.skipIf(process.platform !== "win32")(
  "preserves a target changed after the first Windows rename attempt",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-windows-cas-"));
    const output = join(dir, "CLAUDE.md");
    const expected = Buffer.from("old instructions\n");
    await writeFile(output, expected);
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const replacementSignal = Object.assign(new Error("injected Windows replacement signal"), {
      code: "EPERM"
    });
    vi.mocked(rename).mockImplementationOnce(async () => {
      await actualFs.writeFile(output, "concurrent instructions\n", "utf8");
      throw replacementSignal;
    });

    try {
      await expect(atomicWriteFileIfUnchanged(
        output,
        "new instructions\n",
        expected,
        "target changed"
      )).rejects.toThrow("target changed");

      expect(await actualFs.readFile(output, "utf8")).toBe("concurrent instructions\n");
      expect((await actualFs.readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  }
);
```

- [x] **Step 2: Run the injected test and confirm RED**

Run:

```bash
npx vitest run tests/platform-files-failure.test.ts -t "preserves a target changed after the first Windows rename attempt"
```

Expected on Windows: FAIL because the current fallback moves B to backup and commits the staged replacement. On non-Windows the test is skipped by design.

- [x] **Step 3: Add the final fallback comparison**

In `writeAtomicFile()`, after `isRegularFile(outputFile)` returns true and immediately before `replaceExistingWindowsFile(...)`, add:

```ts
await beforeCommit?.();
```

Unconditional atomic writers have no callback and retain their current behavior.

- [x] **Step 4: Run the injected and complete platform suites and confirm GREEN**

Run:

```bash
npx vitest run tests/platform-files-failure.test.ts -t "preserves a target changed after the first Windows rename attempt"
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: the injected conflict test passes on Windows, all platform tests pass, B remains unchanged, and no temp or backup artifact remains.

### Task 3: Bind Hook Reads And Writes To One Snapshot

**Files:**
- Modify: `tests/hook-storage.test.ts`
- Modify: `src/core/hook-storage.ts`
- Modify: `src/core/hook.ts`
- Verify: `tests/hook.test.ts`

- [x] **Step 1: Write failing storage snapshot and stale-write tests**

Update the existing read assertions to use `.content` and `.bytes`, make normal writes pass the prior read result, and add the deterministic A/B/A and absent/B conflict regressions:

```ts
test("reads existing UTF-8 content and its exact byte snapshot", async () => {
  const file = await writeClaudeFixture("# Project\n");
  const snapshot = await readClaudeMd(file);

  expect(snapshot?.content).toBe("# Project\n");
  expect(snapshot?.bytes.equals(Buffer.from("# Project\n"))).toBe(true);
});

test("rejects a stale managed-block write without overwriting concurrent bytes", async () => {
  const file = await writeClaudeFixture("# Project\n\nuser: A\n");
  const snapshot = await readClaudeMd(file);
  const concurrent = "# Project\n\nuser: B written after hook read\n";
  await writeFile(file, concurrent, "utf8");

  await expect(writeClaudeMd(file, snapshot, "stale A plus hook state\n"))
    .rejects.toThrow("CLAUDE.md changed while the Stop hook was preparing an update");

  expect(await readFile(file, "utf8")).toBe(concurrent);
  expect((await readdir(dirname(file))).filter(name => name.includes(".trimctx-"))).toEqual([]);
});

test("does not overwrite a CLAUDE.md created after a missing read", async () => {
  const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-race-"));
  const directory = join(root, ".claude");
  const file = join(directory, "CLAUDE.md");
  const snapshot = await readClaudeMd(file);
  await mkdir(directory, { recursive: true });
  await writeFile(file, "concurrent instructions\n", "utf8");

  await expect(writeClaudeMd(file, snapshot, "hook state\n"))
    .rejects.toThrow("CLAUDE.md changed while the Stop hook was preparing an update");

  expect(await readFile(file, "utf8")).toBe("concurrent instructions\n");
  expect((await readdir(directory)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});
```

Change the normal write test to read before each write:

```ts
const missing = await readClaudeMd(file);
await writeClaudeMd(file, missing, "first\n");
const first = await readClaudeMd(file);
await writeClaudeMd(file, first, "second\n");
```

- [x] **Step 2: Run storage tests and confirm RED**

Run:

```bash
npx vitest run tests/hook-storage.test.ts
```

Expected: FAIL because reads still return strings and writes are unconditional.

- [x] **Step 3: Implement the storage snapshot and hook wiring**

In `src/core/hook-storage.ts`, replace the string-only contract with:

```ts
import { atomicWriteFileIfUnchanged } from "../platform/files.js";

export interface ClaudeMdSnapshot {
  content: string;
  bytes: Buffer;
}

export async function readClaudeMd(file: string): Promise<ClaudeMdSnapshot | undefined> {
  try {
    const bytes = await readFile(file);
    return { content: bytes.toString("utf8"), bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Failed to read Claude context file: ${file}`, { cause: error });
  }
}

export async function writeClaudeMd(
  file: string,
  expected: ClaudeMdSnapshot | undefined,
  content: string
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await atomicWriteFileIfUnchanged(
    file,
    content,
    expected?.bytes,
    "CLAUDE.md changed while the Stop hook was preparing an update"
  );
}
```

In `src/core/hook.ts`, retain the read result and use its string for the existing transform:

```ts
const claudeMdSnapshot = await readClaudeMd(claudeMdPath);
const existingContent = claudeMdSnapshot?.content;
```

Change both writes to pass the same snapshot:

```ts
await writeClaudeMd(claudeMdPath, claudeMdSnapshot, cleaned);
await writeClaudeMd(claudeMdPath, claudeMdSnapshot, updated);
```

Do not change low-pressure decisions, report formatting, marker transforms, SessionStart behavior, or transcript handling.

- [x] **Step 4: Run storage, hook, context-state, and platform tests and confirm GREEN**

Run:

```bash
npx vitest run tests/hook-storage.test.ts tests/hook.test.ts tests/context-state.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: all targeted tests pass, normal Stop replacement/removal remains unchanged, conflicts preserve the current target, source transcript hashes remain unchanged, and no temp artifact is left.

### Task 4: Document The Superseding Concurrency Contract

**Files:**
- Modify: `docs/superpowers/specs/2026-08-06-hook-runtime-storage-safety-design.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-hook-claude-md-concurrent-write-safety.md`

- [x] **Step 1: Correct the earlier accepted last-writer statement**

Append a dated supersession note to the earlier design. State that the later exact-byte snapshot design supersedes unconditional last-successful-writer behavior, conflicts fail closed, and the final precheck-to-rename interval is not a linearizable CAS.

- [x] **Step 2: Record the implemented boundary and evidence**

Add concise entries to the changelog and status document covering:

- the reproduced A/B/A failure;
- exact-byte existing-versus-absent snapshot semantics;
- checks before staging, before commit, and before Windows fallback replacement;
- conflict preservation and cleanup tests;
- unchanged managed-block scope, transcript read-only behavior, scoring, thresholds, report, compression, and public commands;
- the narrow residual filesystem race and lack of lock/retry guarantees.

- [x] **Step 3: Run documentation checks**

Run:

```bash
rg -n "last-successful-writer|linearizable|changed while the Stop hook" docs CHANGELOG.md
git diff --check -- docs/superpowers/specs/2026-08-06-hook-runtime-storage-safety-design.md docs/superpowers/specs/2026-08-06-hook-claude-md-concurrent-write-safety-design.md docs/superpowers/plans/2026-08-06-hook-claude-md-concurrent-write-safety.md CHANGELOG.md docs/dev/status-and-next-steps.md
```

Expected: the old contract is explicitly superseded, limitations are present, and no whitespace errors are reported.

### Task 5: Verify The Complete Workspace Contract

**Files:**
- Verify only
- Modify only this plan's checkboxes after each command succeeds

- [x] **Step 1: Run focused and full automated checks**

Run:

```bash
npx vitest run tests/hook-storage.test.ts tests/hook.test.ts tests/context-state.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts
npm test
npx tsc -p tsconfig.json --noEmit --pretty false
npm run build
```

Expected: zero test failures and successful TypeScript/build exits.

- [x] **Step 2: Run packed/fresh-install and package-surface checks**

Run:

```bash
npx vitest run tests/package-contents.test.ts
npm pack --dry-run --json --silent
```

Expected: packed/fresh-install smoke passes, the package keeps its established file set, and neither design/plan documents nor private validation artifacts enter the tarball.

- [x] **Step 3: Re-run the deterministic A/B/A probe against the implementation**

Run this standard-input probe; it creates and removes only an operating-system
temporary directory:

```powershell
$probe = @'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readClaudeMd, writeClaudeMd } from "./src/core/hook-storage.ts";

const root = await mkdtemp(join(tmpdir(), "trimctx-hook-cas-probe-"));
const file = join(root, ".claude", "CLAUDE.md");
const a = "# Project\n\nuser: A\n";
const b = "# Project\n\nuser: B written after hook read\n";
try {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, a, "utf8");
  const snapshot = await readClaudeMd(file);
  await writeFile(file, b, "utf8");
  let conflictDetected = false;
  try {
    await writeClaudeMd(file, snapshot, "stale A plus hook state\n");
  } catch (error) {
    conflictDetected = error instanceof Error
      && error.message === "CLAUDE.md changed while the Stop hook was preparing an update";
  }
  const actual = await readFile(file, "utf8");
  const temporaryArtifacts = (await readdir(dirname(file)))
    .filter(name => name.includes(".trimctx-")).length;
  process.stdout.write(JSON.stringify({
    conflict_detected: conflictDetected,
    final_contains_b: actual === b,
    final_contains_stale_a: actual.includes("user: A"),
    temporary_artifacts: temporaryArtifacts
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
'@
$probe | node --import tsx --input-type=module
```

Assert the exact output fields:

```text
conflict_detected: true
final_contains_b: true
final_contains_stale_a: false
temporary_artifacts: 0
```

Expected: the stale write fails with the stable conflict message and B remains byte-identical.

- [x] **Step 4: Inspect final scope and hygiene**

Run:

```bash
git diff --check
git status --short
rg -n "atomicWriteFileIfUnchanged|ClaudeMdSnapshot|writeClaudeMd" src tests
```

Confirm only the intended files changed for this task, existing unrelated dirty files and `.vscode/` remain untouched, public commands remain six, no transcript was written, and no `.tgz`, `.trimctx-*.tmp`, backup, stage, or tamper artifact was left by validation.

- [x] **Step 5: Mark completed plan steps with actual evidence counts**

Update this plan only after reading every command's exit code and output. Record skips separately; do not convert a skipped platform-specific test into a pass claim on another platform.

## Execution Evidence

- TDD RED: six new platform expectations failed because the conditional writer
  did not exist; the Windows fallback regression then failed independently
  because the stale replacement resolved successfully.
- Targeted GREEN: five files and 76 tests passed; the Windows runner executed
  all 15 platform failure tests without skips.
- Full Vitest: 50 files and 504 tests passed.
- Strict TypeScript and `npm run build`: both exited 0.
- Packed/fresh-install smoke: 5/5 passed independently.
- Package dry-run: 22 files; no design, plan, private report, or generated
  tarball entered the package surface.
- Post-fix A/B/A probe: conflict detected, B preserved, stale A absent, zero
  temp artifacts.
- Final repository artifact scan: zero generated tarballs, `output-N.txt`,
  `.trimctx-*.tmp`, `.trimctx-*.bak`, stage, or tamper files.
