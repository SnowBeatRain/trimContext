# Hook Runtime Storage Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits in this working tree.

**Goal:** Make Claude Stop hook CLAUDE.md reads fail closed and managed-block writes atomic while preserving the existing SessionStart/Stop scope and transcript read-only contract.

**Architecture:** Add a focused `hook-storage.ts` filesystem boundary with ENOENT-only missing semantics and the shared atomic writer. Keep `hook.ts` responsible for stdin, analysis, and managed-block orchestration, then cover the boundary and Stop workflow with real-filesystem tests.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:fs/promises`, existing `src/platform/files.ts` atomic writer.

---

### Task 1: Reproduce And Define Hook Storage Reads

**Files:**
- Create: `tests/hook-storage.test.ts`
- Create: `src/core/hook-storage.ts`

- [x] **Step 1: Write failing storage read tests**

Create tests that import `readClaudeMd` and use real temporary paths:

```ts
test("returns undefined only when CLAUDE.md is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-"));
  await expect(readClaudeMd(join(root, ".claude", "CLAUDE.md")))
    .resolves.toBeUndefined();
});

test("reads an existing CLAUDE.md", async () => {
  const file = await writeClaudeFixture("# Project\n");
  await expect(readClaudeMd(file)).resolves.toBe("# Project\n");
});

test("does not treat a non-ENOENT read failure as a missing file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-directory-"));
  await expect(readClaudeMd(directory)).rejects.toThrow(
    `Failed to read Claude context file: ${directory}`
  );
});
```

- [x] **Step 2: Run the read tests and confirm RED**

Run:

```bash
npx vitest run tests/hook-storage.test.ts
```

Expected: FAIL because `src/core/hook-storage.ts` does not exist.

- [x] **Step 3: Implement the minimal read boundary**

Add `readClaudeMd(file)` using `readFile(file, "utf8")`. Return `undefined` only when `(error as NodeJS.ErrnoException).code === "ENOENT"`; otherwise throw `new Error(`Failed to read Claude context file: ${file}`, { cause: error })`.

- [x] **Step 4: Run the read tests and confirm GREEN**

Run the targeted Vitest command and expect all read tests to pass.

### Task 2: Define Atomic Hook Storage Writes

**Files:**
- Modify: `tests/hook-storage.test.ts`
- Modify: `src/core/hook-storage.ts`

- [x] **Step 1: Write failing create and replace tests**

Add a test that calls the wished-for API:

```ts
test("creates and atomically replaces CLAUDE.md without temporary files", async () => {
  const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-"));
  const directory = join(root, ".claude");
  const file = join(directory, "CLAUDE.md");

  await writeClaudeMd(file, "first\n");
  await writeClaudeMd(file, "second\n");

  expect(await readFile(file, "utf8")).toBe("second\n");
  expect((await readdir(directory)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});
```

- [x] **Step 2: Run the write test and confirm RED**

Run the targeted Vitest command. Expected: FAIL because `writeClaudeMd` is not exported.

- [x] **Step 3: Implement the minimal write boundary**

Implement:

```ts
export async function writeClaudeMd(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await atomicWriteFile(file, content);
}
```

- [x] **Step 4: Run storage tests and confirm GREEN**

Run `npx vitest run tests/hook-storage.test.ts` and expect every storage test to pass.

### Task 3: Connect Stop Hook To The Storage Boundary

**Files:**
- Modify: `src/core/hook.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add failing Stop integration regressions**

Extend the CLI test helper to accept an optional working directory, then add real-process tests that:

- use the low-pressure realistic fixture with a pre-existing managed block and assert the block is removed while project text before and after it remains;
- use a generated transcript with candidates and assert an old managed block is replaced exactly once while unrelated project text remains;
- create `.claude/CLAUDE.md` as a directory and assert `hook --dry-run` exits nonzero with `Failed to read Claude context file`;
- calculate the transcript SHA-256 before and after each Stop run and assert equality;
- assert no `.trimctx-` temporary entries remain in `.claude` after writes.

- [x] **Step 2: Run Stop integration tests and confirm RED**

Run:

```bash
npx vitest run tests/hook.test.ts
```

Expected: the unreadable-path test fails because the current broad catch reports success; source inspection also confirms direct `writeFile()` remains.

- [x] **Step 3: Replace inline persistence with storage calls**

In `src/core/hook.ts`:

- remove `readFile` and `writeFile` imports;
- import `readClaudeMd` and `writeClaudeMd` from `./hook-storage.js`;
- delete `readExistingClaudeMd()`;
- call `readClaudeMd(claudeMdPath)` before managed-block decisions;
- replace both direct CLAUDE.md writes with `writeClaudeMd(claudeMdPath, content)`;
- keep SessionStart `mkdir + appendFile` unchanged.

- [x] **Step 4: Run storage and Stop tests and confirm GREEN**

Run:

```bash
npx vitest run tests/hook-storage.test.ts tests/hook.test.ts tests/context-state.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: all targeted tests pass with no warnings or leaked temporary files.

### Task 4: Verify Contracts And Record Status

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-hook-runtime-storage-safety.md`

- [x] **Step 1: Run the complete quality gates**

Run:

```bash
npm test
npm run build
npm pack --dry-run --json --silent
git diff --check
```

Expected: zero test failures, successful TypeScript build, the established package file set without private artifacts, and no whitespace errors.

- [x] **Step 2: Recheck public and safety boundaries**

Use `git diff`, `git status --short`, and targeted searches to confirm:

- public commands remain `init`, `analyze`, `report`, `export`, `new-chat`, `compress`;
- SessionStart still writes only `CLAUDE_ENV_FILE`;
- Stop writes only `.claude/CLAUDE.md` through the managed-block transform;
- scorer, threshold, safety, parser, and compression files are unchanged by this task;
- `.vscode/` and ignored real-validation output are untouched.

- [x] **Step 3: Update documentation and plan status**

Record the confirmed failure, storage boundary, atomic write reuse, transcript hash regression, and fresh verification counts in the changelog and status document. Mark each plan checkbox only after its command or edit has been completed.
