# Session Discovery Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate local session catalog scanning from trusted current-window binding resolution while preserving all CLI and fallback behavior.

**Architecture:** Move read-only root/scanning/latest logic into `src/sessions/catalog.ts` and binding/current resolution into `src/sessions/binding.ts`. Keep `src/sessions/discovery.ts` as a compatibility re-export facade, then migrate direct consumers to the narrower modules.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest.

---

### Task 1: Extract The Session Catalog

**Files:**
- Create: `src/sessions/catalog.ts`
- Modify: `src/sessions/discovery.ts`
- Modify: `tests/session-boundaries.test.ts`

- [x] **Step 1: Add a failing catalog-boundary test**

Import catalog APIs directly and verify an injected home directory drives latest-session discovery:

```ts
import {
  findLatestSession as findLatestSessionFromCatalog,
  listSessions as listSessionsFromCatalog
} from "../src/sessions/catalog.js";

test("resolves latest sessions through the standalone catalog", async () => {
  const home = await mkdtemp(join(tmpdir(), "trimctx-session-catalog-"));
  const claudeDir = join(home, ".claude", "projects", "project-a");
  await mkdir(claudeDir, { recursive: true });
  const file = join(claudeDir, "session-a.jsonl");
  await writeFile(file, "{}\n", "utf8");

  await expect(findLatestSessionFromCatalog("claude", home)).resolves.toBe(file);
  expect(listSessionsFromCatalog).toBe(listSessions);
});
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: FAIL because `src/sessions/catalog.ts` does not exist.

- [x] **Step 3: Move catalog behavior without semantic changes**

Create `catalog.ts` with the existing session types and these signatures:

```ts
export function sessionRoots(source: SessionSource, home = homedir()): string[];
export async function findLatestJsonlUnder(root: string): Promise<{ file: string; mtimeMs: number } | undefined>;
export async function findLatestSession(source: SessionSource, home = homedir()): Promise<string>;
export async function listSessions(source: SessionSource = "auto", home = homedir()): Promise<SessionCandidate[]>;
export function formatNoSessionHelp(source: SessionSource = "auto", home = homedir()): string;
export function prettyHomePath(file: string, home = homedir()): string;
export function parseSessionSource(value: string | undefined): SessionSource;
```

Preserve recursive traversal, missing-directory handling, metadata, source labels, sorting, and errors. Update `discovery.ts` to import/re-export catalog symbols while leaving binding functions there temporarily.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run tests/session-boundaries.test.ts tests/session-picker.test.ts`

Expected: both files pass and existing facade imports still work.

### Task 2: Extract Trusted Binding Resolution

**Files:**
- Create: `src/sessions/binding.ts`
- Modify: `src/sessions/discovery.ts`
- Modify: `tests/session-boundaries.test.ts`

- [x] **Step 1: Add a failing injected-environment test**

Import binding APIs directly and resolve a file without mutating `process.env`:

```ts
import {
  hasCurrentSessionBinding as hasCurrentSessionBindingFromBinding,
  resolveBoundSessionFile as resolveBoundSessionFileFromBinding
} from "../src/sessions/binding.js";

test("resolves trusted bindings from an injected environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-binding-module-"));
  const file = join(dir, "bound-session.jsonl");
  await writeFile(file, "{}\n", "utf8");
  const env = {
    TRIMCTX_TRANSCRIPT_PATH: file,
    TRIMCTX_SESSION_ID: "bound-session"
  } as NodeJS.ProcessEnv;

  expect(hasCurrentSessionBindingFromBinding(env)).toBe(true);
  await expect(resolveBoundSessionFileFromBinding(env)).resolves.toBe(file);
  expect(process.env.TRIMCTX_TRANSCRIPT_PATH).toBe(previousTranscriptPath);
});
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: FAIL because `src/sessions/binding.ts` does not exist.

- [x] **Step 3: Move binding behavior and add dependency injection**

Create `binding.ts` with:

```ts
export interface SessionResolutionOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function hasCurrentSessionBinding(env: NodeJS.ProcessEnv = process.env): boolean;
export async function resolveBoundSessionFile(env: NodeJS.ProcessEnv = process.env): Promise<string>;
export async function resolveCurrentSessionFile(
  source: SessionSource = "auto",
  options: SessionResolutionOptions = {}
): Promise<string>;
export function formatNoCurrentBindingHelp(): string;
```

Move the existing validation and compatibility fallback verbatim. `resolveCurrentSessionFile()` uses `options.env ?? process.env` and passes `options.home` to catalog latest/help functions. Replace `discovery.ts` with re-exports from `catalog.ts` and `binding.ts`.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: all boundary tests pass, including missing, non-file, and session-ID mismatch cases.

### Task 3: Migrate Consumers To Narrow Imports

**Files:**
- Modify: `src/commands/analyze.ts`
- Modify: `src/commands/default.ts`
- Modify: `src/commands/export.ts`
- Modify: `src/commands/new-chat.ts`
- Modify: `src/sessions/picker.ts`
- Modify: `tests/session-boundaries.test.ts`
- Modify: `tests/session-picker.test.ts`

- [x] **Step 1: Add facade identity assertions**

Assert the compatibility facade exports the exact standalone functions:

```ts
expect(findLatestSession).toBe(findLatestSessionFromCatalog);
expect(resolveBoundSessionFile).toBe(resolveBoundSessionFileFromBinding);
```

- [x] **Step 2: Verify the assertions pass before consumer migration**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: PASS, proving the facade is behavior-preserving.

- [x] **Step 3: Replace broad discovery imports**

Use `catalog.ts` for `findLatestSession`, `listSessions`, `parseSessionSource`, and `SessionCandidate`. Use `binding.ts` for `hasCurrentSessionBinding`, `resolveBoundSessionFile`, and `resolveCurrentSessionFile`. Keep `src/core/session.ts` pointed at the compatibility facade for downstream compatibility.

- [x] **Step 4: Run focused command and session regressions**

Run: `npx vitest run tests/session-boundaries.test.ts tests/session-picker.test.ts tests/cli-analyze.test.ts tests/cli-export.test.ts tests/cli-commands.test.ts tests/hook.test.ts`

Expected: all focused tests pass with unchanged CLI output and fallback behavior.

### Task 4: Synchronize Evidence And Verify

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `docs/superpowers/plans/2026-08-06-session-discovery-boundaries.md`

- [x] Record the catalog/binding split, injected test dependencies, compatibility facade, and unchanged behavior.
- [x] Run `npm test` and confirm Windows packed-install/fresh-install coverage remains green.
- [x] Run `npm run build`.
- [x] Run `npm pack --dry-run --json --silent` and inspect the 22-file package.
- [x] Run `git diff --check`, scan this plan for unchecked items, and preserve `.vscode/` untouched.

No commit is created because project instructions require explicit commit confirmation.
