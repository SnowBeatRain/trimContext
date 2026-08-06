# SessionStart Input Preflight Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking. Do not create a worktree or commits in this working tree.

**Goal:** Ensure SessionStart transcript inspection failures happen before the
Claude env append target can be created or modified.

**Architecture:** Reorder the two opens inside the existing handle-verified
append boundary: preflight the optional transcript handle first, then open and
verify the exact `O_APPEND` env handle. Preserve all formats, error contracts,
missing-transcript behavior, and close aggregation.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:fs/promises`, Commander
CLI process tests.

---

### Task 1: Lock The No-Output-On-Input-Failure Contract

**Files:**
- Modify: `tests/platform-files.test.ts`
- Modify: `tests/platform-files-failure.test.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Make the existing aggregate mock independent of open order**

Replace its queued `open()` results with path-based dispatch so the test
continues to model the same output and input handles before and after the
production order change:

```ts
vi.mocked(open).mockImplementation(async (path) =>
  String(path) === "input.jsonl" ? inputHandle : outputHandle
);
```

- [x] **Step 2: Add a real-filesystem failing platform regression**

Add to `tests/platform-files.test.ts`:

```ts
test("does not create the append target when input path inspection fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-preflight-"));
  const output = join(dir, "claude-env.sh");

  await expect(appendFileDistinctFromInput(
    "invalid\0transcript.jsonl",
    output,
    "binding\n"
  )).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });

  await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [x] **Step 3: Add a failing real SessionStart process regression**

Add to `tests/hook.test.ts` next to the alias regressions:

```ts
test("SessionStart does not create CLAUDE_ENV_FILE when transcript inspection fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-preflight-"));
  const envFile = join(dir, "claude-env.sh");

  const result = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({
      session_id: "invalid-path-session",
      transcript_path: "invalid\0transcript.jsonl"
    })}\n`,
    { CLAUDE_ENV_FILE: envFile }
  );

  expect(result.code).not.toBe(0);
  expect(result.stdout).not.toContain("updated trimctx Claude session binding");
  await expect(readFile(envFile)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [x] **Step 4: Run the regressions and confirm RED**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/hook.test.ts -t "input path inspection fails|transcript inspection fails|append operation and every handle close" --testTimeout=30000
```

Expected: the two new tests fail because the old output-first order creates a
zero-byte env target. The order-independent aggregate test passes.

### Task 2: Preflight The Input Handle

**Files:**
- Modify: `src/platform/files.ts`

- [x] **Step 1: Reorder only the two handle opens**

Inside `appendFileDistinctFromInput()`, replace:

```ts
outputHandle = await open(
  outputFile,
  constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
);
inputHandle = await openFileIfExists(inputFile, "r");
```

with:

```ts
inputHandle = await openFileIfExists(inputFile, "r");
outputHandle = await open(
  outputFile,
  constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
);
```

Do not change path identity, stat comparison, append data, handle close order,
or error aggregation.

- [x] **Step 2: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/hook.test.ts --testTimeout=30000
npx tsc -p tsconfig.json --noEmit --pretty false
```

Expected: all platform and hook tests pass, including the existing missing
transcript and aggregate-close contracts.

### Task 3: Document And Verify The Boundary

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-session-start-input-preflight.md`

- [x] **Step 1: Record the failure and constrained fix**

Document the old zero-byte env side effect, input-first handle preflight, the
unchanged `ENOENT` behavior, and the lack of path-format allowlists or rollback
deletion.

- [x] **Step 2: Run complete quality gates**

Run:

```bash
npm test
npx tsc -p tsconfig.json --noEmit --pretty false
npm run build
npx vitest run tests/package-contents.test.ts
npm pack --dry-run --json --silent
```

Expected: zero failures, the Windows packed/fresh-install gate passes, and the
package surface remains 22 files.

- [x] **Step 3: Re-run the real invalid-path process probe**

Assert these fields:

```text
exit_code_nonzero: true
env_file_created: false
stdout_reports_update: false
stderr_has_invalid_path: true
```

- [x] **Step 4: Inspect scope and artifacts**

Run:

```bash
git diff --check
git status --short
rg -n "appendFileDistinctFromInput|input path inspection fails|transcript inspection fails" src tests
```

Confirm the six public commands remain unchanged and repository scans find no
`.tgz`, `output-N.txt`, `.trimctx-*.tmp`, `.trimctx-*.bak`, stage, or tamper
artifacts. Do not commit, merge, push, create a PR/worktree, or clean unrelated
files.

- [x] **Step 5: Record actual evidence**

Mark checkboxes only after reading each command result. Record actual test
counts, Windows execution/skip counts, package file count, probe fields, and
artifact results in this plan.

## Verification Evidence (2026-08-06)

- RED filter: the two new no-output regressions failed because the env files
  existed as empty files; the order-independent aggregate test passed. The
  name filter intentionally skipped 53 unrelated tests.
- GREEN focus: 3 files, 56 tests passed with no skips.
- Full Windows suite: 50 files, 514 tests passed with no skips.
- Strict TypeScript and `npm run build`: exit 0.
- Packed/fresh-install: 5 tests passed; package dry-run retained 22 files and
  created no repository tarball.
- Real invalid-path probe: nonzero exit, no env file, no stdout success report,
  and the underlying invalid-path classification remained visible.
- Final scope: public help still listed exactly six commands,
  `git diff --check` exited 0, implementation references were present, and the
  artifact scan returned zero matches.
- The existing dirty `main`, `.vscode/`, and private validation artifacts were
  preserved. No commit, merge, push, PR, worktree, cleanup, or unrelated-file
  mutation was performed.
