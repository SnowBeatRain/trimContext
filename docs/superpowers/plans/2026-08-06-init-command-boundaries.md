# Init Command Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while executing this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `init` planning, prompting, and asset installation into focused modules while preserving CLI behavior and preventing predictable partial multi-asset installs.

**Architecture:** Create pure `init-plan.ts`, injectable `init-prompt.ts`, and filesystem-focused `init-installer.ts` modules. Keep Commander registration, summary/next-step copy, and hook orchestration in `init.ts`, with `packageRoot` captured per registration.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest.

---

### Task 1: Extract Pure Init Planning

**Files:**
- Create: `src/commands/init-plan.ts`
- Create: `tests/init-boundaries.test.ts`

- [x] **Step 1: Add failing plan tests**

Directly import the wished-for API and verify parsing, asset order, and explicit package-root isolation:

```ts
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import {
  createInitAssets,
  parseInitClient,
  parseInitTarget
} from "../src/commands/init-plan.js";

describe("init planning", () => {
  test("plans Claude and Codex assets from explicit roots", () => {
    expect(createInitAssets("package-a", "all", "base-a")).toEqual([
      {
        client: "claude",
        source: join("package-a", "plugins", "trimctx"),
        destination: join("base-a", ".claude", "plugins", "trimctx"),
        label: "Claude Code plugin commands"
      },
      {
        client: "codex",
        source: join("package-a", "codex", "skills", "trimctx"),
        destination: join("base-a", ".codex", "skills", "trimctx"),
        label: "Codex skill"
      }
    ]);
    expect(createInitAssets("package-b", "claude", "base-b")[0]).toMatchObject({
      source: join("package-b", "plugins", "trimctx"),
      destination: join("base-b", ".claude", "plugins", "trimctx")
    });
  });

  test("parses only the established client and target values", () => {
    expect(parseInitClient(undefined)).toBe("all");
    expect(parseInitClient("claude")).toBe("claude");
    expect(parseInitTarget("project")).toBe("project");
    expect(() => parseInitClient("vim")).toThrow("client must be one of: all, claude, codex");
    expect(() => parseInitTarget("global")).toThrow("target must be one of: user, project");
  });
});
```

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: FAIL because `src/commands/init-plan.ts` does not exist.

- [x] **Step 3: Add the pure planning module**

Create these exact public contracts:

```ts
export type InitClient = "all" | "claude" | "codex";
export type InitTarget = "user" | "project";

export interface InitAsset {
  client: Exclude<InitClient, "all">;
  source: string;
  destination: string;
  label: string;
}

export function createInitAssets(
  packageRoot: string,
  client: InitClient,
  baseDir: string
): InitAsset[];

export function parseInitClient(value: string | undefined): InitClient;
export function parseInitTarget(value: string | undefined): InitTarget;
```

Move the current values, source/destination paths, order, labels, defaults, and error text without reading global state.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: both planning tests pass.

### Task 2: Extract Interactive Target Resolution

**Files:**
- Create: `src/commands/init-prompt.ts`
- Modify: `tests/init-boundaries.test.ts`

- [x] **Step 1: Add failing prompt tests**

Use an injected prompt and output collector, not real stdin:

```ts
import {
  isInteractiveInput,
  resolveInitTarget,
  type InitPrompt
} from "../src/commands/init-prompt.js";

test("resolves prompt aliases and retries invalid answers", async () => {
  const answers = ["invalid", "local"];
  const writes: string[] = [];
  const prompt: InitPrompt = {
    question: async () => answers.shift() ?? ""
  };

  await expect(resolveInitTarget(undefined, prompt, text => writes.push(text))).resolves.toBe("project");
  expect(writes).toEqual(["Please choose 1 for user/global or 2 for project.\n"]);
});

test("requires a prompt when target is omitted", async () => {
  await expect(resolveInitTarget(undefined)).rejects.toThrow(
    "target is required in non-interactive mode; pass --target user or --target project"
  );
});

test("detects forced and TTY interactivity from injected facts", () => {
  expect(isInteractiveInput({ TRIMCTX_FORCE_INTERACTIVE: "1" }, false, false)).toBe(true);
  expect(isInteractiveInput({}, true, true)).toBe(true);
  expect(isInteractiveInput({}, true, false)).toBe(false);
});
```

Also assert `""`, `"1"`, `"user"`, and `"global"` resolve to user while `"2"`, `"project"`, and `"local"` resolve to project.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: FAIL because `src/commands/init-prompt.ts` does not exist.

- [x] **Step 3: Add the prompt module**

Create:

```ts
export interface InitPrompt {
  question(prompt: string): Promise<string>;
  close?(): void;
}

export class PromptSession implements InitPrompt;

export function isInteractiveInput(
  env?: NodeJS.ProcessEnv,
  inputIsTty?: boolean,
  outputIsTty?: boolean
): boolean;

export async function resolveInitTarget(
  value: string | undefined,
  prompt?: InitPrompt,
  write?: (text: string) => void
): Promise<InitTarget>;
```

Use production process defaults only in `PromptSession`/`isInteractiveInput`; keep accepted aliases, prompt copy, retry copy, explicit target parsing, and non-interactive error exact. The caller owns and closes the prompt.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: all planning and prompt tests pass.

### Task 3: Extract And Preflight Asset Installation

**Files:**
- Create: `src/commands/init-installer.ts`
- Modify: `tests/init-boundaries.test.ts`

- [x] **Step 1: Add failing installer tests**

Create temporary source/destination trees and direct `InitAsset` fixtures. Cover:

```ts
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { installInitAssets } from "../src/commands/init-installer.js";

test("dry-run validates templates and writes nothing", async () => {
  const fixture = await initAssetFixture();
  await expect(installInitAssets([fixture.asset], { dryRun: true })).resolves.toEqual([
    `- ${fixture.asset.label}: ${fixture.asset.destination}`
  ]);
  await expect(access(fixture.destinationFile)).rejects.toThrow();
});

test("preflights all conflicts before copying the first asset", async () => {
  const first = await initAssetFixture("first");
  const second = await initAssetFixture("second");
  await mkdir(second.asset.destination, { recursive: true });

  await expect(installInitAssets([first.asset, second.asset])).rejects.toThrow("already exists");
  await expect(access(first.destinationFile)).rejects.toThrow();
});

test("force replaces only trimctx destinations", async () => {
  const fixture = await initAssetFixture();
  await mkdir(fixture.asset.destination, { recursive: true });
  await writeFile(fixture.staleFile, "stale", "utf8");

  await installInitAssets([fixture.asset], { force: true });

  await expect(readFile(fixture.destinationFile, "utf8")).resolves.toBe("current");
  await expect(access(fixture.staleFile)).rejects.toThrow();
});
```

The fixture must make every destination end in `trimctx`. Add a custom unsafe destination ending in another name and assert force rejects it without deleting the directory.

- [x] **Step 2: Run RED**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: FAIL because `src/commands/init-installer.ts` does not exist.

- [x] **Step 3: Add the installer with full preflight**

Create:

```ts
export interface InstallInitAssetsOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function installInitAssets(
  assets: readonly InitAsset[],
  options?: InstallInitAssetsOptions
): Promise<string[]>;
```

Implementation order:

1. Assert every source is readable.
2. For dry-run, return planned lines immediately.
3. Read existence for every destination.
4. Reject every existing non-force destination before writes.
5. Validate every existing forced destination ends in exactly `trimctx` and is not its own parent.
6. Sequentially replace/copy assets and return lines in input order.

Preserve existing error text and recursive copy/removal behavior.

- [x] **Step 4: Run GREEN**

Run: `npx vitest run tests/init-boundaries.test.ts`

Expected: all direct boundary tests pass, including no first-asset write on second-asset conflict.

### Task 4: Reduce Init Command To Orchestration

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `tests/init-boundaries.test.ts`

- [x] **Step 1: Lock facade-visible behavior before migration**

Run the existing end-to-end contract first:

Run: `npx vitest run tests/cli-commands.test.ts tests/hook.test.ts tests/cli-surface.test.ts`

Expected: all tests pass before changing the command facade.

- [x] **Step 2: Replace local responsibilities with narrow imports**

Import:

```ts
import { installInitAssets } from "./init-installer.js";
import { createInitAssets, parseInitClient } from "./init-plan.js";
import { isInteractiveInput, PromptSession, resolveInitTarget } from "./init-prompt.js";
```

Capture `options.packageRoot` in the `.action()` closure and pass it into `initClientAssets(options, packageRoot)`. Replace the asset loop with `installInitAssets()`, append its lines, and delete the local types, global `packageRoot`, prompt class, parsers, planner, filesystem helpers, and replacement functions. Keep summary, hook, and next-step order exact.

- [x] **Step 3: Verify the migrated facade**

Run: `npx vitest run tests/init-boundaries.test.ts tests/cli-commands.test.ts tests/hook.test.ts tests/cli-surface.test.ts`

Expected: direct and end-to-end init/hook/surface tests pass.

- [x] **Step 4: Run package-focused regression**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: package assets, bundled-only contents, six public commands, and packed fresh-install smoke all pass.

### Task 5: Synchronize Evidence And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-init-command-boundaries.md`

- [x] Record the plan/prompt/installer split, removal of mutable registration state, preflight safety behavior, and unchanged CLI/hooks/package contracts.
- [x] Run `npm test` and confirm all tests pass.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json --silent` and inspect the 22-file package.
- [x] Run `git diff --check`, inspect the final diff, and preserve `.vscode/` untouched.

No worktree or commit is created because the current user instructions require changes to remain in the existing worktree and require explicit approval before committing.
