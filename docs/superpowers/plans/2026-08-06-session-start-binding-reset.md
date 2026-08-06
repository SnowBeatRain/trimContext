# SessionStart Binding Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not authorized for this project session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every SessionStart event replaces the complete trimctx window binding so an omitted session ID cannot survive from an older transcript.

**Architecture:** Keep the existing append-only, window-specific `CLAUDE_ENV_FILE` mechanism. Change the SessionStart writer to append both trimctx exports in one call on every successful event, using an empty quoted value when `session_id` is absent, and protect the behavior with a two-process integration regression.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest

---

### Task 1: Reproduce stale SessionStart identity in an integration test

**Files:**
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add the failing two-SessionStart regression**

Add this test after `SessionStart binding is analyzed through analyze --json`:

```ts
test("SessionStart clears a stale session ID when the next binding omits it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-reset-"));
  const envFile = join(dir, "claude-env.sh");
  const oldTranscript = join(dir, "old-session.jsonl");
  const newTranscript = join(dir, "new-session.jsonl");
  const fixture = await readFile(join("tests", "fixtures", "claude-code-realistic.jsonl"), "utf8");
  await writeFile(oldTranscript, fixture, "utf8");
  await writeFile(newTranscript, fixture, "utf8");
  const oldHash = await sha256(oldTranscript);
  const newHash = await sha256(newTranscript);

  const first = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({ session_id: "old-session", transcript_path: oldTranscript })}\n`,
    { CLAUDE_ENV_FILE: envFile }
  );
  const second = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({ transcript_path: newTranscript })}\n`,
    { CLAUDE_ENV_FILE: envFile }
  );

  expect(first.code).toBe(0);
  expect(second.code).toBe(0);
  const content = await readFile(envFile, "utf8");
  expect(content.endsWith([
    `export TRIMCTX_TRANSCRIPT_PATH='${newTranscript}'`,
    "export TRIMCTX_SESSION_ID=''",
    ""
  ].join("\n"))).toBe(true);
  const bindings = parseEnvBindings(content);
  expect(bindings.TRIMCTX_SESSION_ID).toBe("");

  const analyzed = await runCli(["analyze", "--json"], bindings);
  expect(analyzed.code).toBe(0);
  expect((JSON.parse(analyzed.stdout) as { input: { file: string } }).input.file).toBe(newTranscript);
  expect(await sha256(oldTranscript)).toBe(oldHash);
  expect(await sha256(newTranscript)).toBe(newHash);
});
```

- [x] **Step 2: Run the test and verify the expected RED state**

Run:

```bash
npx vitest run tests/hook.test.ts --testTimeout=30000
```

Expected: the new test fails because the env file ends after the new transcript export instead of ending with `export TRIMCTX_SESSION_ID=''`.

### Task 2: Append a complete binding snapshot

**Files:**
- Modify: `src/core/hook.ts`
- Test: `tests/hook.test.ts`

- [x] **Step 1: Make the minimal implementation change**

Replace the conditional session ID append with a fixed two-line snapshot:

```ts
const lines = [
  `export TRIMCTX_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}`,
  `export TRIMCTX_SESSION_ID=${shellQuote(input.session_id ?? "")}`
];
```

Do not change stdin parsing, required-path validation, `CLAUDE_ENV_FILE` scope, shell quoting, append persistence, or bound-session validation.

- [x] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/hook.test.ts --testTimeout=30000
```

Expected: all hook integration tests pass, including the new repeated SessionStart regression.

- [x] **Step 3: Run the adjacent binding boundary tests**

Run:

```bash
npx vitest run tests/hook.test.ts tests/session-boundaries.test.ts tests/cli-export.test.ts --testTimeout=30000
```

Expected: all selected tests pass with no warnings or unhandled errors.

### Task 3: Document the optional-ID reset contract

**Files:**
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] **Step 1: Clarify user-facing SessionStart behavior**

Update the existing SessionStart binding paragraph in both usage documents to state that a missing hook `session_id` is persisted as an empty binding, preventing an older ID from being paired with the new transcript. Preserve the statements that bound commands do not fall back to another session and that ID matching is checked only when an ID exists.

- [x] **Step 2: Record the fix and its boundaries**

Add concise entries to `CHANGELOG.md` and `docs/dev/status-and-next-steps.md` covering:

```text
- SessionStart now appends a complete transcript/session binding snapshot.
- Missing session_id explicitly clears an older ID in the same CLAUDE_ENV_FILE.
- The env file remains window-scoped and append-only; transcripts remain read-only.
```

Move the next audit candidate in the status document away from this resolved issue; choose the next item only after the final verification evidence is available.

### Task 4: Run final quality gates and inspect scope

**Files:**
- Verify all files changed by Tasks 1-3

- [x] **Step 1: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all test files and tests pass.

- [x] **Step 2: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected: `tsc -p tsconfig.json` exits 0.

- [x] **Step 3: Verify the packed package manifest**

Run:

```bash
npm pack --dry-run --json --silent
```

Expected: exit 0, the established public package assets remain present, and no `.tgz` is left in the repository.

- [x] **Step 4: Inspect diff hygiene and worktree boundaries**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; `.vscode/` remains untouched and untracked; no unrelated file is reverted or reformatted.

- [x] **Step 5: Mark this plan complete without committing**

Check every plan box only after its command or file evidence is present. Do not create a commit, push, or PR without separate explicit authorization.
