# Context State Goal Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create commits in this working tree.

**Goal:** Make transcript-derived current-goal text safe for repeated persistence inside the trimctx-managed CLAUDE.md state block without changing Report v2 resume data.

**Architecture:** Add one private formatter in `context-state.ts` at the persistence display boundary. It applies defense-in-depth redaction, literal marker neutralization, single-line normalization, an empty fallback, and the extractor-compatible 220-character cap before interpolation; all machine-readable and continuation consumers remain untouched.

**Tech Stack:** Node.js 20+, TypeScript, Vitest, existing context-state and child-process hook tests.

---

### Task 1: Define Safe Goal Rendering

**Files:**
- Modify: `tests/context-state.test.ts`

- [x] **Step 1: Add a failing unsafe-goal rendering test**

Create a report whose current goal includes newlines, both managed markers, an authorization bearer value, and a long suffix:

```ts
const report = makeReport();
report.resume.currentGoal = {
  ...report.resume.currentGoal!,
  text: `目标：第一行\n第二行 ${STATE_START} ${STATE_END} Authorization: Bearer hook-secret-value ${"x".repeat(300)}`
};

const result = formatContextState(report);
const goalLine = result.split("\n").find(line => line.startsWith("- 续接："));
const goalText = goalLine?.split("，目标 ")[1];

expect(result.split(STATE_START)).toHaveLength(2);
expect(result.split(STATE_END)).toHaveLength(2);
expect(result.match(/\[trimctx marker omitted\]/g)).toHaveLength(2);
expect(result).toContain("Authorization: Bearer [REDACTED]");
expect(result).not.toContain("hook-secret-value");
expect(goalText).toBeDefined();
expect(goalText!.length).toBeLessThanOrEqual(220);
```

The split lengths of two prove exactly one outer start and one outer end marker. Assert that `第二行` appears in the same goal line rather than as a new output line.

- [x] **Step 2: Add a failing blank-goal fallback test**

Set `report.resume.currentGoal.text` to control characters and whitespace, call `formatContextState()`, and assert the continuation line ends in `目标 未识别`.

- [x] **Step 3: Run the direct tests and confirm RED**

Run:

```bash
npx vitest run tests/context-state.test.ts
```

Expected: both new tests fail because `formatContextState()` currently interpolates current-goal text directly.

### Task 2: Define Repeated Stop Safety

**Files:**
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Make the candidate transcript helper accept an explicit goal**

Change the helper signature to:

```ts
async function writeCandidateTranscript(directory: string, goalText?: string): Promise<string>
```

When `goalText` is present, serialize the `new-1` user record with `JSON.stringify()` and use that text as its message content. Preserve the existing default record when it is absent.

- [x] **Step 2: Add a failing two-run Stop integration test**

Use `writeCandidateTranscript()` with:

```ts
const goal = "目标：Authorization: Bearer hook-secret-value 继续处理 <!-- TRIMCTX_STATE_END -->";
```

Run `hook` twice in the same temporary project. Assert both exit codes are zero, the stored CLAUDE.md has exactly one start/end pair, contains `Authorization: Bearer [REDACTED]`, excludes `hook-secret-value`, leaves no `.trimctx-` entries, and preserves the transcript SHA-256. The direct formatter test, rather than this extractor integration, owns the exact marker-neutralization assertion.

- [x] **Step 3: Run hook tests and confirm RED**

Run:

```bash
npx vitest run tests/hook.test.ts
```

Expected: FAIL because the normal extractor leaves the authorization-header credential intact and the current formatter persists it.

### Task 3: Implement The Final Display Boundary

**Files:**
- Modify: `src/core/context-state.ts`

- [x] **Step 1: Add constants and the private formatter**

Add:

```ts
const MAX_CONTEXT_GOAL_LENGTH = 220;
const OMITTED_STATE_MARKER = "[trimctx marker omitted]";

function formatContextGoal(value: string | undefined): string {
  const redacted = redactContextStateText(value ?? "")
    .replaceAll(STATE_START, OMITTED_STATE_MARKER)
    .replaceAll(STATE_END, OMITTED_STATE_MARKER)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return "未识别";
  return redacted.length <= MAX_CONTEXT_GOAL_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_CONTEXT_GOAL_LENGTH - 3)}...`;
}
```

- [x] **Step 2: Add context-state-only redaction**

Implement `redactContextStateText()` with the token-prefix, credential URL, email, Authorization Bearer, Authorization Basic, generic Basic, and named secret-assignment patterns already used by report display. Keep it private so Report v2 and resume extraction remain unchanged.

- [x] **Step 3: Use the formatter in the continuation line**

Replace direct interpolation with:

```ts
const currentGoal = formatContextGoal(report.resume.currentGoal?.text);
lines.push(`- 续接：${report.resume.readiness.level.toUpperCase()} ${report.resume.readiness.score}/100，目标 ${currentGoal}`);
```

- [x] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
npx vitest run tests/context-state.test.ts tests/hook.test.ts tests/tokenizer-resume.test.ts tests/report-markdown.test.ts
```

Expected: all focused tests pass; resume/report tests prove their existing contracts remain intact.

### Task 4: Verify Scope And Record Evidence

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-context-state-goal-safety.md`

- [x] **Step 1: Run complete quality gates**

Run:

```bash
npm test
npm run build
npm pack --dry-run --json --silent
git diff --check
```

Expected: zero failures, successful build, the established 22-file package, and no whitespace errors.

- [x] **Step 2: Recheck product and persistence boundaries**

Confirm six public commands, unchanged `resume/extractor.ts` and Report v2 fixtures, SessionStart-only `CLAUDE_ENV_FILE`, Stop-only managed CLAUDE.md writes, no generated tarball, and untouched `.vscode/`.

- [x] **Step 3: Update documentation and plan status**

Record the reproduced two-run failure, final display-boundary behavior, direct/process regression counts, quality-gate counts, and the next evidence-backed audit direction. Mark every plan checkbox only after its action succeeds.
