# Export Command Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreleased public `transcript` command with the shorter `export` command while preserving the existing Markdown format and all safety behavior.

**Architecture:** Rename only public entry points and the thin CLI command module. Keep `formatTranscriptMarkdown`, `trimctx.transcript.v1`, parser behavior, file safety, and the generated Markdown structure unchanged. Update the unarchived OpenSpec change, tests, packaged Claude/Codex assets, and active documentation as one release-surface contract.

**Tech Stack:** Node.js 20+, TypeScript, commander, vitest, OpenSpec, npm pack

**Workspace rule:** Execute in the current working tree because the complete feature is still uncommitted there. Do not create commits, push, archive the OpenSpec change, change package version, or modify real JSONL input.

---

### Task 1: Amend the unarchived OpenSpec contract

**Files:**
- Modify: `openspec/changes/add-conversation-transcript-command/proposal.md`
- Modify: `openspec/changes/add-conversation-transcript-command/design.md`
- Modify: `openspec/changes/add-conversation-transcript-command/data-model.md`
- Modify: `openspec/changes/add-conversation-transcript-command/specs/cli-command-surface/spec.md`
- Modify: `openspec/changes/add-conversation-transcript-command/specs/conversation-transcript-export/spec.md`
- Modify: `openspec/changes/add-conversation-transcript-command/specs/conversation-transcript-integration/spec.md`
- Modify: `openspec/changes/add-conversation-transcript-command/tasks.md`

- [ ] **Step 1: Change only public command references to `export`**

Use these contracts consistently:

```text
trimctx export [file] -o <conversation.md>
/trimctx:export
src/commands/export.ts
tests/cli-export.test.ts
plugins/trimctx/commands/trimctx/export.md
```

Keep domain and format names unchanged:

```text
trimctx.transcript.v1
formatTranscriptMarkdown
src/core/transcript-markdown.ts
# trimctx Conversation Transcript
conversation-transcript-export
```

- [ ] **Step 2: Add a rename section to `tasks.md`**

Append checkboxes covering: public tests RED, CLI implementation GREEN, client assets GREEN, docs scan, full tests/build/pack/real-sample validation, and final strict OpenSpec verification. Reopen the affected release-validation checkboxes until fresh evidence exists.

- [ ] **Step 3: Validate the amended specification**

Run:

```bash
openspec validate add-conversation-transcript-command --strict
```

Expected: exit 0 and `Change 'add-conversation-transcript-command' is valid`.

---

### Task 2: Write the failing public-command tests

**Files:**
- Rename: `tests/cli-transcript.test.ts` to `tests/cli-export.test.ts`
- Modify: `tests/cli-export.test.ts`
- Modify: `tests/cli-surface.test.ts`
- Modify: `tests/cli-commands.test.ts`
- Modify: `tests/package-contents.test.ts`

- [ ] **Step 1: Rename the CLI test suite and command invocations**

In `tests/cli-export.test.ts`, rename the suite and helper invocations while retaining all existing safety assertions:

```ts
describe("export CLI", () => {
  // Existing tests invoke runCli(["export", file, "-o", output]).
});
```

Update completion output expectations:

```ts
expect(result.stdout).toContain(`export: ${output}`);
```

- [ ] **Step 2: Lock the six-command surface and reject the removed name**

Update `tests/cli-surface.test.ts`:

```ts
for (const command of ["init", "analyze", "report", "export", "new-chat", "compress"]) {
  expect(result.stdout).toMatch(new RegExp(`^  ${command}\\b`, "m"));
}
expect(result.stdout).not.toMatch(/^  transcript\\b/m);
```

Add a removed-command test:

```ts
test("rejects the unreleased transcript command", async () => {
  const result = await runCli(["transcript", "--help"]);
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("unknown command");
});
```

Update the dedicated help assertions:

```ts
const result = await runCli(["export", "--help"]);
expect(result.stdout).toContain("Usage: trimctx export [options] [file]");
expect(result.stdout).toContain("trusted current-window binding");
expect(result.stdout).toContain("-o, --output <conversation.md>");
```

- [ ] **Step 3: Update package smoke expectations before assets or implementation**

Use these packed paths and commands in `tests/package-contents.test.ts`:

```ts
expect(files).toContain("plugins/trimctx/commands/trimctx/export.md");
expect(files).not.toContain("plugins/trimctx/commands/trimctx/transcript.md");
await execFileAsync(trimctxBin, ["export", transcriptSource, "-o", transcriptOutput], {
  shell: process.platform === "win32"
});
expect(exportHelp.stdout).toContain("Usage: trimctx export [options] [file]");
```

Keep the existing message-count, per-event content, input hash, and forbidden-package-file checks unchanged.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/cli-export.test.ts tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts
```

Expected: failures because `export` is not registered, `transcript` is still public, and `export.md` is not packaged. The failures must be behavioral assertions, not import or syntax errors.

---

### Task 3: Rename the CLI implementation

**Files:**
- Rename: `src/commands/transcript.ts` to `src/commands/export.ts`
- Modify: `src/commands/export.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Rename and update the command module**

The public registration must be:

```ts
export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .argument("[file]", "Conversation JSONL file; omit only with a trusted current-window binding.")
    .requiredOption("-o, --output <conversation.md>")
    .description("Export a complete normalized conversation transcript as Markdown.")
```

Retain the existing action body, SHA-256 calculation, `parseJsonl`, `formatTranscriptMarkdown`, input snapshot, and `atomicWriteFileDistinctFromInput`. Change only user-facing command labels:

```ts
const OUTPUT_CONFLICT_MESSAGE = "Export output must be different from input file";
throw new Error("export output must end in .md");
process.stdout.write([
  `export: ${options.output}`,
  `messages: ${result.messageCount}`,
  `source: ${result.source}`,
  ""
].join("\n"));
```

- [ ] **Step 2: Register only `export` and reject the removed name**

Update `src/commands/index.ts`:

```ts
import { registerExportCommand } from "./export.js";

registerReportCommand(program);
registerExportCommand(program);
registerCompressCommand(program);
```

There must be no `registerTranscriptCommand` import or registration.

Because the root CLI has a default action, add `transcript` to the existing removed-command operand guard in `src/cli.ts` so `trimctx transcript --help` reports an unknown command instead of falling through to root help.

- [ ] **Step 3: Run CLI-focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/cli-export.test.ts tests/cli-surface.test.ts tests/cli-commands.test.ts
```

Expected: all tests pass, including `transcript --help` returning unknown command.

---

### Task 4: Rename Claude and Codex client assets

**Files:**
- Rename: `plugins/trimctx/commands/trimctx/transcript.md` to `plugins/trimctx/commands/trimctx/export.md`
- Modify: `plugins/trimctx/commands/trimctx/export.md`
- Modify: `plugins/trimctx/README.md`
- Modify: `plugins/trimctx/.system`
- Modify: `codex/skills/trimctx/SKILL.md`
- Test: `tests/package-contents.test.ts`

- [ ] **Step 1: Rename the Claude command asset**

The asset must invoke:

```text
trimctx export "$TRIMCTX_TRANSCRIPT_PATH" -o conversation.md
```

Its heading must use `/trimctx:export`; retain the current missing-binding stop behavior, no-latest rule, unredacted warning, review requirement, and original-file read-only statement.

- [ ] **Step 2: Update packaged integration references**

Use `/trimctx:export` in plugin README and `.system`. Use this explicit-file command in the Codex skill:

```bash
trimctx export <file.jsonl> -o conversation.md
```

Do not claim a verified Codex slash command or current-window binding.

- [ ] **Step 3: Run package contents tests and verify GREEN**

Run:

```bash
npx vitest run tests/package-contents.test.ts
```

Expected: 5 tests pass, including actual packed installation and full normalized-message export.

---

### Task 5: Synchronize active documentation and plans

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/iteration-plan.md`
- Modify: `docs/dev/roadmap.md`
- Modify: `docs/dev/execution-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-30-conversation-transcript-command-design.md`
- Modify: `docs/superpowers/plans/2026-07-30-conversation-transcript-command.md`
- Modify: `docs/superpowers/specs/2026-07-31-export-command-rename-design.md`
- Modify: `docs/superpowers/plans/2026-07-31-export-command-rename.md`

- [ ] **Step 1: Replace public invocations without replacing domain nouns**

Current examples must use:

```bash
trimctx export path/to/session.jsonl -o conversation.md
trimctx export -o conversation.md
```

Public command lists must use:

```text
init, analyze, report, export, new-chat, compress
```

Claude command lists must use `/trimctx:export`. Keep phrases such as “original transcript”, `TRIMCTX_TRANSCRIPT_PATH`, `trimctx.transcript.v1`, parser-normalized transcript, and transcript adapter unchanged.

- [ ] **Step 2: Update release notes without changing version**

The `Unreleased` entry must describe `trimctx export [file] -o <conversation.md>` and `/trimctx:export`. Do not edit `package.json` version.

- [ ] **Step 3: Scan for stale public names**

Run:

```bash
rg -n "trimctx transcript|/trimctx:transcript|command\(\"transcript\"\)|commands/trimctx/transcript\.md|src/commands/transcript\.ts|tests/cli-transcript\.test\.ts|\[\"transcript\"" src tests plugins codex README.md README_zh.md docs AGENTS.md CHANGELOG.md openspec/changes/add-conversation-transcript-command --glob '!docs/superpowers/plans/2026-07-31-export-command-rename.md' --glob '!docs/superpowers/specs/2026-07-31-export-command-rename-design.md'
```

Expected: no current public command references. Generic transcript nouns, format identifiers, environment variables, and historical files outside this change may remain.

---

### Task 6: Run release-level verification

**Files:**
- Modify: `openspec/changes/add-conversation-transcript-command/tasks.md`
- Write ignored output only: `tmp-real-validation/conversation.md`

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
npx vitest run tests/transcript-markdown.test.ts tests/cli-export.test.ts tests/parser.claude-code-jsonl.test.ts tests/parser.openai-jsonl.test.ts tests/parser.codex-jsonl.test.ts tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts tests/platform-files.test.ts tests/platform-files-failure.test.ts
```

Expected: all files and tests pass.

- [ ] **Step 2: Run full tests and builds**

Run:

```bash
npm test
npm run build
npm run build:publish
```

Expected: all tests pass and both TypeScript and bundled builds exit 0.

- [ ] **Step 3: Audit the package manifest**

Run:

```bash
npm pack --dry-run --json
```

Required: `dist/cli.js`, `plugins/trimctx/commands/trimctx/export.md`, Codex skill, and bilingual docs. Forbidden: `plugins/trimctx/commands/trimctx/transcript.md`, `src/`, `.jsonl`, `.vscode/`, and `tmp-real-validation/`.

- [ ] **Step 4: Re-run the real-sample export read-only check**

Run `node --import tsx src/cli.ts export <sample.jsonl> -o tmp-real-validation/conversation.md`, compare the input SHA-256 before and after, and verify parser message count equals Markdown event count. Never modify the source JSONL.

- [ ] **Step 5: Run final static gates**

Run:

```bash
git diff --check
openspec validate add-conversation-transcript-command --strict
git status --short
```

Expected: diff and strict validation exit 0; status contains only intended feature files plus the user's pre-existing `.vscode/`.

- [ ] **Step 6: Complete the OpenSpec checklist**

Mark rename and reopened release tasks complete only after their corresponding fresh evidence exists. Final state must have no unchecked task and no current public `transcript` command reference.
