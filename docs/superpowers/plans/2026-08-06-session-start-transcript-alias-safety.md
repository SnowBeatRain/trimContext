# SessionStart Transcript Alias Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create a worktree or commits in this working tree.

**Goal:** Prevent SessionStart from appending Claude environment bindings to the source transcript or any existing filesystem alias of it.

**Architecture:** Add a handle-based append helper that compares a freshly opened transcript with the exact env handle used for `O_APPEND`. Wire only SessionStart to this boundary; preserve its complete two-export snapshot, append-only env behavior, missing-transcript behavior, and every Stop hook contract.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, `node:fs/promises`, Commander CLI process tests.

---

### Task 1: Add A Handle-Verified Append Boundary

**Files:**
- Modify: `tests/platform-files.test.ts`
- Modify: `tests/platform-files-failure.test.ts`
- Modify: `src/platform/files.ts`

- [x] **Step 1: Write failing real-filesystem alias tests**

Import `appendFileDistinctFromInput` in `tests/platform-files.test.ts`. Add
separate tests for direct identity, hardlink identity, existing env append,
missing env creation, and a missing transcript:

```ts
test("rejects appending to the input path without changing its bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
  const input = join(dir, "session.jsonl");
  const original = "source transcript\n";
  await writeFile(input, original, "utf8");

  await expect(appendFileDistinctFromInput(
    input,
    input,
    "binding\n",
    "same file"
  )).rejects.toThrow("same file");

  expect(await readFile(input, "utf8")).toBe(original);
});

test("rejects appending through a hardlink to the input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
  const input = join(dir, "session.jsonl");
  const output = join(dir, "claude-env.sh");
  const original = "source transcript\n";
  await writeFile(input, original, "utf8");
  await link(input, output);

  await expect(appendFileDistinctFromInput(
    input,
    output,
    "binding\n",
    "same file"
  )).rejects.toThrow("same file");

  expect(await readFile(input, "utf8")).toBe(original);
  expect(await readFile(output, "utf8")).toBe(original);
});

test("appends to a distinct existing file without truncating it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
  const input = join(dir, "session.jsonl");
  const output = join(dir, "claude-env.sh");
  await writeFile(input, "source transcript\n", "utf8");
  await writeFile(output, "existing binding\n", "utf8");

  await appendFileDistinctFromInput(input, output, "new binding\n", "same file");

  expect(await readFile(input, "utf8")).toBe("source transcript\n");
  expect(await readFile(output, "utf8")).toBe("existing binding\nnew binding\n");
});

test("creates a distinct missing append target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
  const input = join(dir, "session.jsonl");
  const output = join(dir, "claude-env.sh");
  await writeFile(input, "source transcript\n", "utf8");

  await appendFileDistinctFromInput(input, output, "binding\n", "same file");

  expect(await readFile(input, "utf8")).toBe("source transcript\n");
  expect(await readFile(output, "utf8")).toBe("binding\n");
});

test("allows a distinct binding when the transcript is not created yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
  const input = join(dir, "future-session.jsonl");
  const output = join(dir, "claude-env.sh");

  await appendFileDistinctFromInput(input, output, "binding\n", "same file");

  await expect(readFile(input)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(output, "utf8")).toBe("binding\n");
});
```

In `tests/platform-files-failure.test.ts`, import the helper and add a mocked
operation-plus-close regression. Its `finally` must reset the queued `open`
mocks even while the production export is still absent:

```ts
test("reports append operation and every handle close failure", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const operationError = new Error("injected append failure");
  const outputCloseError = new Error("injected append output close failure");
  const inputCloseError = new Error("injected append input close failure");
  const outputHandle = {
    stat: async () => ({ dev: 1, ino: 2 }),
    writeFile: async () => { throw operationError; },
    close: async () => { throw outputCloseError; }
  } as unknown as FileHandle;
  const inputHandle = {
    stat: async () => ({ dev: 1, ino: 1 }),
    close: async () => { throw inputCloseError; }
  } as unknown as FileHandle;
  vi.mocked(open)
    .mockResolvedValueOnce(outputHandle)
    .mockResolvedValueOnce(inputHandle);

  let caught: unknown;
  try {
    await appendFileDistinctFromInput("input.jsonl", "env.sh", "binding\n");
  } catch (error) {
    caught = error;
  } finally {
    vi.mocked(open).mockReset().mockImplementation(actualFs.open);
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([
    operationError,
    outputCloseError,
    inputCloseError
  ]);
});
```

- [x] **Step 2: Run the new tests and confirm RED**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: the six new tests fail because `appendFileDistinctFromInput` is not
exported; every existing platform test remains isolated.

- [x] **Step 3: Implement path and open-handle identity checks**

Add the helper before the existing write operations in `src/platform/files.ts`:

```ts
export async function appendFileDistinctFromInput(
  inputFile: string,
  outputFile: string,
  data: string,
  conflictMessage = "Output file must be different from input file"
): Promise<void> {
  if (sameResolvedPath(inputFile, outputFile)) {
    throw new Error(conflictMessage);
  }

  let outputHandle: FileHandle | undefined;
  let inputHandle: FileHandle | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    outputHandle = await open(
      outputFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
    );
    inputHandle = await openFileIfExists(inputFile, "r");
    if (inputHandle !== undefined) {
      const [outputStat, inputStat] = await Promise.all([
        outputHandle.stat(),
        inputHandle.stat()
      ]);
      if (outputStat.dev === inputStat.dev && outputStat.ino === inputStat.ino) {
        throw new Error(conflictMessage);
      }
    }
    await outputHandle.writeFile(data, "utf8");
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  const handles = [outputHandle, inputHandle]
    .filter((handle): handle is FileHandle => handle !== undefined);
  const closeResults = await Promise.allSettled(handles.map((handle) => handle.close()));
  const closeErrors = closeResults.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );

  if (operationFailed && closeErrors.length === 0) throw operationError;
  if (!operationFailed && closeErrors.length === 1) throw closeErrors[0];
  if (operationFailed || closeErrors.length > 0) {
    throw new AggregateError(
      [
        ...(operationFailed ? errorComponents(operationError) : []),
        ...closeErrors
      ],
      `Failed to append or close distinct output: ${outputFile}`
    );
  }
}

function sameResolvedPath(leftFile: string, rightFile: string): boolean {
  const left = resolve(leftFile);
  const right = resolve(rightFile);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function openFileIfExists(
  file: string,
  flags: "r"
): Promise<FileHandle | undefined> {
  try {
    return await open(file, flags);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
```

Do not change `appendFileDistinctFromInput` data after opening, and do not use
`appendFile()` or reopen `outputFile` after identity validation.

- [x] **Step 4: Run platform tests and confirm GREEN**

Run:

```bash
npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts
npx tsc -p tsconfig.json --noEmit --pretty false
```

Expected: every platform test passes and TypeScript accepts the handle/mocked
signatures.

### Task 2: Wire SessionStart And Add Process Regressions

**Files:**
- Modify: `tests/hook.test.ts`
- Modify: `src/core/hook.ts`

- [x] **Step 1: Write failing same-path and hardlink process tests**

Import `link` in `tests/hook.test.ts` and add:

```ts
test("SessionStart rejects CLAUDE_ENV_FILE equal to the transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-conflict-"));
  const transcriptPath = join(dir, "session.jsonl");
  const original = '{"type":"user","message":{"role":"user","content":"keep original"}}\n';
  await writeFile(transcriptPath, original, "utf8");
  const transcriptHash = await sha256(transcriptPath);

  const result = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({ session_id: "session", transcript_path: transcriptPath })}\n`,
    { CLAUDE_ENV_FILE: transcriptPath }
  );

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Claude session env file must be different from transcript");
  expect(result.stdout).not.toContain("updated trimctx Claude session binding");
  expect(await sha256(transcriptPath)).toBe(transcriptHash);
  expect(await readFile(transcriptPath, "utf8")).toBe(original);
});

test("SessionStart rejects a CLAUDE_ENV_FILE hardlink to the transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-alias-"));
  const transcriptPath = join(dir, "session.jsonl");
  const envFile = join(dir, "claude-env.sh");
  const original = '{"type":"user","message":{"role":"user","content":"keep original"}}\n';
  await writeFile(transcriptPath, original, "utf8");
  await link(transcriptPath, envFile);
  const transcriptHash = await sha256(transcriptPath);

  const result = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({ session_id: "session", transcript_path: transcriptPath })}\n`,
    { CLAUDE_ENV_FILE: envFile }
  );

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Claude session env file must be different from transcript");
  expect(await sha256(transcriptPath)).toBe(transcriptHash);
  expect(await readFile(envFile, "utf8")).toBe(original);
});
```

- [x] **Step 2: Run the process tests and confirm RED**

Run:

```bash
npx vitest run tests/hook.test.ts -t "SessionStart rejects"
```

Expected: both tests fail because the current direct append returns success and
changes the transcript inode's bytes.

- [x] **Step 3: Replace direct append with the verified handle operation**

In `src/core/hook.ts`:

- remove `appendFile` from the filesystem import;
- import `appendFileDistinctFromInput` from `../platform/files.js`;
- retain the existing parent `mkdir`;
- replace the direct append with:

```ts
await appendFileDistinctFromInput(
  input.transcript_path,
  envFile,
  `${lines.join("\n")}\n`,
  "Claude session env file must be different from transcript"
);
```

Do not change the binding lines, optional ID reset, shell quoting, success
message, or Stop path.

- [x] **Step 4: Run hook and adjacent tests and confirm GREEN**

Run:

```bash
npx vitest run tests/hook.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/session-boundaries.test.ts tests/cli-export.test.ts --testTimeout=30000
npx tsc -p tsconfig.json --noEmit --pretty false
```

Expected: all selected tests pass; direct and hardlink conflicts preserve
transcript hashes, while ordinary/repeated SessionStart still appends complete
bindings.

### Task 3: Document The Read-Only Enforcement

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `docs/superpowers/plans/2026-08-06-session-start-transcript-alias-safety.md`

- [x] **Step 1: Update user-facing hook write scope**

In both usage documents, extend the existing SessionStart hook write-scope
bullet to state that trimctx rejects `CLAUDE_ENV_FILE` when it resolves to the
transcript or an existing filesystem alias. Keep the existing append and
window-scoped descriptions.

- [x] **Step 2: Record the failure, fix, and residual boundary**

Add changelog/status entries covering the successful same-file corruption
probe, open-handle identity validation, hardlink regression, unchanged binding
format, and narrow compare-to-append residual race. Correct the older status
lines claiming SessionStart append logic was unchanged and concurrent Stop
last-writer behavior remained unconditional.

- [x] **Step 3: Run documentation and plan checks**

Run:

```bash
rg -n "env file must be different|filesystem alias|文件系统别名|SessionStart.*transcript" CHANGELOG.md docs
git diff --check -- CHANGELOG.md docs/dev/status-and-next-steps.md docs/user/usage.md docs/user/usage_zh.md docs/superpowers/specs/2026-08-06-session-start-transcript-alias-safety-design.md docs/superpowers/plans/2026-08-06-session-start-transcript-alias-safety.md
```

Expected: both languages disclose the enforcement, older status statements no
longer contradict current behavior, and no whitespace errors are reported.

### Task 4: Verify The Complete Contract

**Files:**
- Verify only
- Modify only this plan's checkboxes and evidence section after commands succeed

- [x] **Step 1: Run focused and full automated checks**

Run:

```bash
npx vitest run tests/hook.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/session-boundaries.test.ts tests/cli-export.test.ts --testTimeout=30000
npm test
npx tsc -p tsconfig.json --noEmit --pretty false
npm run build
```

Expected: zero test failures and successful TypeScript/build exits.

- [x] **Step 2: Run package gates**

Run:

```bash
npx vitest run tests/package-contents.test.ts
npm pack --dry-run --json --silent
```

Expected: packed/fresh-install 5/5, the established 22-file package surface,
and no generated `.tgz` in the repository.

- [x] **Step 3: Re-run the real same-path CLI probe**

Run this standard-input probe; it creates and removes only an operating-system
temporary directory:

```powershell
$probe = @'
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "trimctx-session-start-alias-probe-"));
const transcript = join(root, "session.jsonl");
const original = '{"type":"user","message":{"role":"user","content":"keep original"}}\n';
const digest = (value) => createHash("sha256").update(value).digest("hex");
try {
  await writeFile(transcript, original, "utf8");
  const child = spawn(
    process.execPath,
    ["--import", "tsx", resolve("src/cli.ts"), "hook", "--session-start"],
    {
      cwd: process.cwd(),
      env: { ...process.env, CLAUDE_ENV_FILE: transcript },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.stdin.end(JSON.stringify({
    session_id: "same-file-session",
    transcript_path: transcript
  }) + "\n");
  const code = await new Promise(resolveExit => child.on("close", resolveExit));
  const after = await readFile(transcript);
  process.stdout.write(JSON.stringify({
    exit_code_nonzero: code !== 0,
    transcript_unchanged: digest(after) === digest(Buffer.from(original)),
    appended_env_binding: after.toString("utf8").includes("TRIMCTX_TRANSCRIPT_PATH"),
    stable_conflict_error: stderr.includes("Claude session env file must be different from transcript"),
    stdout_reports_update: stdout.includes("updated trimctx Claude session binding")
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
'@
$probe | node --import tsx --input-type=module
```

Assert these exact fields:

```text
exit_code_nonzero: true
transcript_unchanged: true
appended_env_binding: false
stable_conflict_error: true
stdout_reports_update: false
```

- [x] **Step 4: Inspect final scope and artifacts**

Run:

```bash
git diff --check
git status --short
rg -n "appendFileDistinctFromInput|Claude session env file must be different" src tests
```

Confirm the six public commands remain unchanged, `.vscode/` and private real
validation artifacts remain untouched, and repository scans find zero `.tgz`,
`output-N.txt`, `.trimctx-*.tmp`, `.trimctx-*.bak`, stage, or tamper artifacts.

- [x] **Step 5: Record actual evidence and finish without git mutations**

Mark each checkbox only after reading its command output. Record Windows test
execution versus skip counts accurately. Keep the current dirty `main` as-is;
do not commit, merge, push, create a PR, or clean unrelated work.

## Verification Evidence (2026-08-06)

- Focused regression: 5 files, 76 tests passed.
- Full suite: 50 files, 512 tests passed on Windows; no tests were skipped.
- Strict TypeScript and `npm run build`: exit 0.
- Packed/fresh-install gate: 5 tests passed; package dry-run retained 22 files
  and created no repository tarball.
- Real same-path probe: nonzero exit, unchanged transcript, no appended binding,
  stable conflict error, and no success message on stdout.
- Final checks: six-command public help unchanged, `git diff --check` exited 0,
  implementation references were present, and artifact scan returned zero matches.
- Git state remained the existing dirty `main`; no commit, merge, push, PR,
  worktree, cleanup, or unrelated-file mutation was performed.
