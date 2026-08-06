# Resume Evidence Trust Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents or create commits in this workspace.

**Goal:** Prevent tool containers and low-confidence evidence from overstating Report v2 continuation facts and readiness.

**Architecture:** Keep extraction in `resume/extractor.ts` and readiness weighting in `resume/readiness.ts`. Apply category-specific source predicates at extraction time, preserve useful diagnostic tool evidence at low confidence, and let readiness count only medium/high evidence.

**Tech Stack:** TypeScript, Vitest, existing Report v2 and resume types.

---

### Task 1: Enforce Extraction Trust Boundaries

**Files:**
- Modify: `tests/tokenizer-resume.test.ts`
- Modify: `src/core/resume/extractor.ts`

- [x] **Step 1: Add a failing tool-container regression test**

Create a Claude-style `user` message whose `analysis.kind` is `tool_result` and whose body contains a fake goal, decision, file path, failure, and `npm test`. Add an actual earlier user goal, an assistant next step, and a `tool_use` path.

Require:

```typescript
expect(state.currentGoal?.messageId).toBe("actual-goal");
expect(state.decisions).toEqual([]);
expect(state.activeFiles.map((item) => item.path)).toContain("src/current.ts");
expect(state.activeFiles.map((item) => item.path)).not.toContain("src/ignored.ts");
expect(state.activeFiles.find((item) => item.path === "src/current.ts")?.confidence).toBe("low");
expect(state.failures.find((item) => item.messageId === "tool-result")?.confidence).toBe("low");
expect(state.testSignals.find((item) => item.messageId === "tool-result")?.confidence).toBe("low");
```

- [x] **Step 2: Run the regression test and verify RED**

Run:

```bash
npx vitest run tests/tokenizer-resume.test.ts --testNamePattern="tool containers" --testTimeout=30000
```

Expected: the latest user-wrapped tool result becomes the current goal, supplies a decision and ignored path, and receives high confidence.

- [x] **Step 3: Implement category-specific source predicates**

In `src/core/resume/extractor.ts`:

- make `findCurrentGoal()` use only conversational user bodies;
- define conversational bodies as user/assistant messages excluding `metadata`, `tool_use`, and `tool_result` kinds;
- collect active files only from conversational bodies or `tool_use` messages;
- retain tool containers for failure/test extraction;
- replace role-only confidence with message-aware confidence that returns `low` for `tool_use` and `tool_result` before considering the normalized role.

Keep the existing extraction patterns, limits, ordering, summarization, and redaction unchanged.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same command from Step 2. Expected: the new test passes.

### Task 2: Exclude Low-Confidence Signals From Readiness

**Files:**
- Modify: `tests/tokenizer-resume.test.ts`
- Modify: `src/core/resume/readiness.ts`

- [x] **Step 1: Add a failing readiness-confidence test**

Call `scoreResumeReadiness()` with a high-confidence current goal, a medium-confidence next step, and low-confidence decisions, active files, and test signals:

```typescript
expect(readiness).toEqual({
  score: 55,
  level: "partial",
  missing: ["user decisions", "active files", "test signals"],
  signals: {
    current_goal: true,
    decisions: false,
    active_files: false,
    test_signals: false,
    next_steps: true
  }
});
```

- [x] **Step 2: Run the readiness test and verify RED**

Run:

```bash
npx vitest run tests/tokenizer-resume.test.ts --testNamePattern="low-confidence" --testTimeout=30000
```

Expected: current code returns score 100 and `ready` because it checks only array presence.

- [x] **Step 3: Implement trusted-evidence readiness checks**

Add a local predicate that accepts only evidence whose confidence is not `low`. Use it for current goal, decisions, active files, test signals, and next steps before applying the existing weights, level thresholds, labels, and output shape.

- [x] **Step 4: Run resume/report/new-chat focused tests**

Run:

```bash
npx vitest run tests/tokenizer-resume.test.ts tests/reporter.test.ts tests/assessment.test.ts tests/cli-commands.test.ts --testTimeout=30000
```

Expected: all focused tests pass with unchanged Report v2 schema and continuation artifact structure.

### Task 3: Verify Real Reports And Quality Gates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/dev/status-and-next-steps.md`

- [x] **Step 1: Regenerate representative reports**

Regenerate the four ignored reports in `tmp-real-validation/report-v2-audit/`, hashing every input before and after. Parse reports with Node UTF-8 JSON APIs and output only aggregate origin kind/confidence counts.

Expected:

- no current goal or decision has `tool_use` / `tool_result` origin;
- no active file has `tool_result` origin;
- retained failure/test tool evidence is low confidence;
- all report count/reference invariants pass;
- every input hash is unchanged.

- [x] **Step 2: Document the behavior and evidence**

Record the source-trust boundary, conservative readiness effect, four-sample audit, and unchanged scorer/threshold/compression/public-command contracts. Do not include private paths, IDs, message content, or generated reports.

- [x] **Step 3: Run complete verification**

Run:

```bash
npm test
npm run build
npm pack --dry-run --json --silent
git diff --check
```

Also run strict TypeScript over all `scripts/*.ts`, confirm packed/fresh-install tests pass, confirm the npm manifest remains 22 files, and scan for `.tgz`, `.stage`, `.bak`, and `.trimctx-*.tmp` residue.

- [x] **Step 4: Update actual counts only after verification**

Update `docs/dev/status-and-next-steps.md` with the actual complete test count. Keep formal Phase 0 trust explicitly unlocked until multi-source manual labels and a real private OpenAI export exist.
