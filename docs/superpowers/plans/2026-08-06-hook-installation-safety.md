# Hook Installation Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:systematic-debugging and superpowers:test-driven-development while executing this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve malformed/unreadable Claude settings and unrelated mixed-group hooks, then isolate hook planning and persistence behind an atomic write boundary.

**Architecture:** Move pure SessionStart/Stop merge policy into `hook-settings.ts`, move settings I/O into `hook-installer.ts`, and keep `hook.ts` as the hidden runtime command facade. Add a generic atomic writer to the existing platform file module and reuse its Windows-safe replacement mechanics.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest.

---

### Task 1: Lock The Confirmed Regressions

**Files:**
- Modify: `tests/hook.test.ts`

- [x] **Step 1: Add an invalid-JSON preservation test**

```ts
test("init --with-hooks rejects invalid settings without overwriting them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-invalid-"));
  const settingsDir = join(dir, ".claude");
  const settingsPath = join(settingsDir, "settings.json");
  const invalidSettings = "{broken";
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsPath, invalidSettings, "utf8");

  const result = await initWithHooks(dir);

  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("Claude settings JSON is invalid");
  expect(await readFile(settingsPath, "utf8")).toBe(invalidSettings);
});
```

- [x] **Step 2: Strengthen the force-preservation test**

Change each existing force fixture event to one mixed group containing both the trimctx and user commands:

```ts
SessionStart: [{ hooks: [
  { type: "command", command: "trimctx hook --session-start" },
  { type: "command", command: "other session start" }
] }],
Stop: [{ hooks: [
  { type: "command", command: "trimctx hook" },
  { type: "command", command: "other stop" }
] }]
```

Keep assertions requiring one trimctx and one user hook per event.

- [x] **Step 3: Run RED and confirm both root causes**

Run: `npx vitest run tests/hook.test.ts -t "invalid settings|without removing other"`

Expected: two failures. Invalid JSON returns success and is overwritten; mixed-group user hook counts are zero.

### Task 2: Extract Pure Hook Settings Planning

**Files:**
- Create: `src/commands/hook-settings.ts`
- Create: `tests/hook-settings.test.ts`

- [x] **Step 1: Add failing direct planner tests**

```ts
import { describe, expect, test } from "vitest";
import {
  planHookSettings,
  plannedHookSettings
} from "../src/commands/hook-settings.js";

describe("Claude hook settings planning", () => {
  test("adds missing hooks while preserving unknown settings", () => {
    const settings = {
      permissions: { allow: ["Bash"] },
      hooks: { Custom: [{ hooks: [{ type: "command", command: "custom" }] }] }
    };

    expect(planHookSettings(settings)).toMatchObject({
      status: "write",
      settings: {
        permissions: settings.permissions,
        hooks: {
          Custom: settings.hooks.Custom,
          SessionStart: [{ hooks: [{ type: "command", command: "trimctx hook --session-start" }] }],
          Stop: [{ hooks: [{ type: "command", command: "trimctx hook" }] }]
        }
      }
    });
  });

  test("force removes only matching entries from mixed groups", () => {
    const result = planHookSettings({
      hooks: {
        SessionStart: [{ matcher: "all", hooks: [
          { type: "command", command: "trimctx hook --session-start" },
          { type: "command", command: "user session" }
        ] }],
        Stop: [{ hooks: [
          { type: "command", command: "trimctx hook" },
          { type: "command", command: "user stop" }
        ] }]
      }
    }, { force: true });

    expect(result.status).toBe("write");
    expect(result.status === "write" ? result.settings : {}).toMatchObject({
      hooks: {
        SessionStart: [
          { matcher: "all", hooks: [{ type: "command", command: "user session" }] },
          { hooks: [{ type: "command", command: "trimctx hook --session-start" }] }
        ],
        Stop: [
          { hooks: [{ type: "command", command: "user stop" }] },
          { hooks: [{ type: "command", command: "trimctx hook" }] }
        ]
      }
    });
  });
});
```

Also test `already_installed`, the privacy-safe preview, and invalid root/hooks/event/group/group-hooks/hook-entry containers.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/hook-settings.test.ts`

Expected: FAIL because `src/commands/hook-settings.ts` does not exist.

- [x] **Step 3: Add the pure planner**

Create:

```ts
export type HookSettings = Record<string, unknown>;

export type HookSettingsPlan =
  | { status: "already_installed" }
  | { status: "write"; settings: HookSettings };

export function planHookSettings(
  input: unknown,
  options?: { force?: boolean }
): HookSettingsPlan;

export function plannedHookSettings(): HookSettings;
```

Use exact command matching on both `type === "command"` and command text. Validate only required containers. Preserve unknown fields and events. In force mode, filter matching entries inside each group, retain mixed groups and their fields, remove trimctx-only emptied groups, then append one current trimctx group per event.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/hook-settings.test.ts`

Expected: all pure planner tests pass.

### Task 3: Add A Generic Atomic Writer

**Files:**
- Modify: `src/platform/files.ts`
- Modify: `tests/platform-files.test.ts`
- Modify: `tests/platform-files-failure.test.ts`

- [x] **Step 1: Add failing generic atomic-write tests**

Import `atomicWriteFile` and add:

```ts
test("atomically creates and replaces ordinary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
  const output = join(dir, "settings.json");
  await writeFile(output, "old\n", "utf8");

  await atomicWriteFile(output, "new\n");

  expect(await readFile(output, "utf8")).toBe("new\n");
  expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
});
```

In the mocked failure suite, inject an `EACCES` rename failure for `atomicWriteFile()` and assert the existing target is unchanged and temp files are removed.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts`

Expected: FAIL because `atomicWriteFile` is not exported.

- [x] **Step 3: Share atomic temp/replace mechanics**

Add:

```ts
export async function atomicWriteFile(outputFile: string, data: string): Promise<void>;
```

Extract the existing same-directory exclusive temp creation, write, Windows replacement fallback, backup restore, and final cleanup into a private helper with an optional async `beforeCommit` callback. `atomicWriteFile()` calls it directly. `atomicWriteFileDistinctFromInput()` retains initial input snapshot/output identity checks and supplies its second snapshot/identity check through `beforeCommit`.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/file-safety.test.ts`

Expected: generic and transcript-specific atomic tests pass.

### Task 4: Extract Hook Installation And Reduce The Facade

**Files:**
- Create: `src/commands/hook-installer.ts`
- Create: `tests/hook-installer.test.ts`
- Modify: `src/commands/hook.ts`
- Modify: `src/commands/init.ts`

- [x] **Step 1: Add failing installer tests**

Directly import `installHooks()` and cover missing file, invalid JSON, and privacy-safe dry-run:

```ts
test("creates missing settings with both hooks", async () => {
  const settingsPath = await missingSettingsPath();
  await expect(installHooks(settingsPath)).resolves.toEqual([
    `installed experimental Claude hooks in ${settingsPath}`
  ]);
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(plannedHookSettings());
});

test("preserves invalid JSON", async () => {
  const settingsPath = await writeSettings("{broken");
  await expect(installHooks(settingsPath)).rejects.toThrow("Claude settings JSON is invalid");
  await expect(readFile(settingsPath, "utf8")).resolves.toBe("{broken");
});

test("dry-run does not reveal existing settings", async () => {
  const settingsPath = await writeSettings(JSON.stringify({ env: { TOKEN: "secret" } }));
  const lines = await installHooks(settingsPath, { dryRun: true });
  expect(lines.join("\n")).not.toContain("secret");
  expect(lines.join("\n")).toContain("trimctx hook --session-start");
});
```

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/hook-installer.test.ts`

Expected: FAIL because `src/commands/hook-installer.ts` does not exist.

- [x] **Step 3: Add robust installer I/O**

Implement `installHooks(settingsPath, options)` with this sequence:

1. Read UTF-8 settings; only ENOENT becomes `{}`.
2. Parse JSON and throw `Claude settings JSON is invalid: <path>` without content on syntax failure.
3. Call `planHookSettings()`.
4. Return existing already-installed copy when applicable.
5. For dry-run, return the existing two lines using only `plannedHookSettings()`.
6. For real changes, create the parent and call `atomicWriteFile()` with two-space JSON plus trailing newline.

Wrap non-ENOENT read errors with `Failed to read Claude settings: <path>` and retain the cause.

- [x] **Step 4: Migrate consumers and verify both regressions GREEN**

Delete settings planning/I/O from `hook.ts`; retain only `createHookCommand()`. Change `init.ts` to import from `hook-installer.ts`.

Run: `npx vitest run tests/hook-settings.test.ts tests/hook-installer.test.ts tests/hook.test.ts tests/init-boundaries.test.ts tests/cli-commands.test.ts`

Expected: direct modules, invalid JSON preservation, mixed-group preservation, init, and runtime hooks all pass.

### Task 5: Synchronize Evidence And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-hook-installation-safety.md`

- [x] Record fail-closed settings reads, mixed-group preservation, pure planning/install boundaries, atomic persistence, and unchanged hook/runtime/public CLI scope.
- [x] Run `npm test` and confirm all tests pass.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json --silent` and inspect the 22-file package.
- [x] Run `git diff --check`, inspect the final diff, and preserve `.vscode/` untouched.

No worktree or commit is created because the current user instructions require changes to remain in the existing worktree and require explicit approval before committing.
