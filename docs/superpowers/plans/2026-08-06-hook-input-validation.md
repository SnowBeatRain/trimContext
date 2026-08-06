# Hook Input Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not authorized for this project session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both hidden hook modes one runtime-validated, privacy-safe stdin boundary that rejects malformed known fields before any filesystem or analysis side effect.

**Architecture:** Extract stdin reading and JSON parsing from `src/core/hook.ts` into `src/core/hook-input.ts`. First preserve valid behavior while stabilizing JSON syntax errors, then add unknown-first object and known-field validation; both SessionStart and Stop continue to consume the same `HookInput` API.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest

---

### Task 1: Stabilize malformed JSON errors and extract the input boundary

**Files:**
- Create: `src/core/hook-input.ts`
- Modify: `src/core/hook.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add a failing process-level privacy regression**

Add this test after the existing missing-`transcript_path` hook test:

```ts
test("hook rejects malformed JSON without echoing stdin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-hook-invalid-json-"));
  const envFile = join(dir, "claude-env.sh");
  const secret = "hook-input-secret-value";

  const result = await runCliWithInput(
    ["hook", "--session-start"],
    `{"transcript_path":"${secret}"`,
    { CLAUDE_ENV_FILE: envFile }
  );

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Claude hook input must be valid JSON");
  expect(result.stderr).not.toContain(secret);
  expect(await fileExists(envFile)).toBe(false);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/hook.test.ts --testTimeout=30000
```

Expected: the new test fails because the current CLI prints the engine-defined JSON syntax message instead of `Claude hook input must be valid JSON`; the env file remains absent.

- [x] **Step 3: Extract the compatible parser and wrap syntax errors**

Create `src/core/hook-input.ts`:

```ts
interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return parseHookInput(Buffer.concat(chunks).toString("utf8"));
}

export function parseHookInput(raw: string): HookInput {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as HookInput;
  } catch (error) {
    throw new Error("Claude hook input must be valid JSON", { cause: error });
  }
}
```

In `src/core/hook.ts`, import `readHookInput`, remove the local `HookInput` interface and generic `readStdinJson<T>()`, and replace both calls with `await readHookInput()`.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/hook.test.ts --testTimeout=30000
```

Expected: all hook integration tests pass and malformed stdin is not echoed.

### Task 2: Validate top-level shape and known field types

**Files:**
- Modify: `src/core/hook-input.ts`
- Create: `tests/hook-input.test.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add direct parser tests for compatibility and invalid shapes**

Create `tests/hook-input.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseHookInput } from "../src/core/hook-input.js";

describe("hook input boundary", () => {
  test("keeps validated known fields and ignores unknown fields", () => {
    expect(parseHookInput("   ")).toEqual({});
    expect(parseHookInput(JSON.stringify({
      transcript_path: "session.jsonl",
      session_id: "",
      stop_hook_active: false,
      future_field: "preserved by Claude, ignored by trimctx"
    }))).toEqual({
      transcript_path: "session.jsonl",
      session_id: "",
      stop_hook_active: false
    });
  });

  test.each([
    { raw: "null", error: "Claude hook input must be an object" },
    { raw: "[]", error: "Claude hook input must be an object" },
    {
      raw: JSON.stringify({ transcript_path: 123 }),
      error: "Claude hook input transcript_path must be a string"
    },
    {
      raw: JSON.stringify({ session_id: null }),
      error: "Claude hook input session_id must be a string"
    },
    {
      raw: JSON.stringify({ stop_hook_active: "false" }),
      error: "Claude hook input stop_hook_active must be a boolean"
    }
  ])("rejects an invalid known shape: $error", ({ raw, error }) => {
    expect(() => parseHookInput(raw)).toThrow(error);
  });
});
```

- [x] **Step 2: Add process tests proving validation precedes side effects**

Add this test near the malformed JSON regression in `tests/hook.test.ts`:

```ts
test("hook modes reject invalid field types before side effects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-hook-invalid-fields-"));
  const envFile = join(dir, "claude-env.sh");
  const projectDir = join(dir, "project");
  await mkdir(projectDir, { recursive: true });

  const sessionStart = await runCliWithInput(
    ["hook", "--session-start"],
    `${JSON.stringify({ transcript_path: "unused.jsonl", session_id: 123 })}\n`,
    { CLAUDE_ENV_FILE: envFile }
  );
  const stop = await runCliWithInput(
    ["hook", "--dry-run"],
    `${JSON.stringify({ transcript_path: 123 })}\n`,
    {},
    projectDir
  );

  expect(sessionStart.code).not.toBe(0);
  expect(sessionStart.stderr).toContain("Claude hook input session_id must be a string");
  expect(sessionStart.stderr).not.toContain("value.replace");
  expect(await fileExists(envFile)).toBe(false);

  expect(stop.code).not.toBe(0);
  expect(stop.stderr).toContain("Claude hook input transcript_path must be a string");
  expect(stop.stderr).not.toContain("path argument");
  expect(await fileExists(join(projectDir, ".claude"))).toBe(false);
});
```

- [x] **Step 3: Run direct and process tests and verify RED**

Run:

```bash
npx vitest run tests/hook-input.test.ts tests/hook.test.ts --testTimeout=30000
```

Expected: the known-field filtering and invalid-shape assertions fail because the extracted parser still casts parsed JSON without runtime validation.

- [x] **Step 4: Implement unknown-first runtime validation**

Replace `parseHookInput()`'s successful cast with explicit validation and add these helpers:

```ts
export function parseHookInput(raw: string): HookInput {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error("Claude hook input must be valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("Claude hook input must be an object");
  }

  return {
    transcript_path: optionalString(parsed, "transcript_path"),
    session_id: optionalString(parsed, "session_id"),
    stop_hook_active: optionalBoolean(parsed, "stop_hook_active")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Claude hook input ${field} must be a string`);
  }
  return value;
}

function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Claude hook input ${field} must be a boolean`);
  }
  return value;
}
```

- [x] **Step 5: Run direct, hook, and adjacent tests and verify GREEN**

Run:

```bash
npx vitest run tests/hook-input.test.ts tests/hook.test.ts tests/session-boundaries.test.ts tests/cli-export.test.ts --testTimeout=30000
```

Expected: all selected tests pass with stable messages, no invalid-input writes, valid binding behavior unchanged, and no warnings or unhandled errors.

### Task 3: Record the hook-input contract and next audit

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] **Step 1: Record the runtime validation boundary**

Add concise entries documenting that hook stdin now parses as `unknown`, rejects invalid top-level/known-field types before side effects, allows unknown fields, and wraps malformed JSON without echoing input content.

- [x] **Step 2: Preserve scope and select the next evidence-based audit**

Record that SessionStart snapshots, Stop managed-block scope, transcript read-only behavior, reports, scoring, thresholds, and compression are unchanged. Replace the current hook-input candidate with an audit of `stop_hook_active` reentrancy semantics, which is declared in the hook payload but currently unused.

### Task 4: Run final quality gates

**Files:**
- Verify all files changed by Tasks 1-3

- [x] **Step 1: Run the complete test suite**

Run `npm test` and require zero failures.

- [x] **Step 2: Run the TypeScript build**

Run `npm run build` and require exit code 0.

- [x] **Step 3: Verify packed package contents**

Run `npm pack --dry-run --json --silent`; require the established 22-file public package, six-command smoke coverage, and no generated `.tgz`.

- [x] **Step 4: Inspect diff hygiene and boundaries**

Run `git diff --check`, `git status --short`, and inspect the focused diff. Require no whitespace errors, no `.vscode/` diff, no unrelated reversions, and no change to public commands.

- [x] **Step 5: Complete the plan without repository integration**

Check all plan items only after evidence exists. Keep the current `main` worktree as-is; do not commit, push, create a PR, or clean up user changes.
