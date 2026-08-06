# Phase 0 Validation Evidence Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 `phase0:review` 在样本数、来源覆盖、批次执行率或输入只读证据不足时错误返回 `trust_status: locked`。

**Architecture:** 新增纯批次证据模块，自动读取 reports 目录中的 `phase0-results.json`，重算并核对执行指标、来源覆盖和 report 集合；`phase0-review.ts` 将其与现有人工标签 gate 合并。缺失/不完整证据保持 `review_required`，完整但失败的执行门返回 `failed`。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL、现有 Phase 0 开发脚本

---

### Task 1: 用集成回归锁定误锁根因

**Files:**
- Modify: `tests/phase0-review.test.ts`

- [x] **Step 1: 把单报告锁定行为改成安全期望**

新增一项只写 1 份报告和完整人工标签、但不写 `phase0-results.json` 的测试：

```ts
await runReview(reportsDir, labelsDir, root);

const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
expect(output.metrics.remove_candidate_precision).toBe(1);
expect(output.metrics.protected_recall).toBe(1);
expect(output.validation).toMatchObject({
  available: false,
  ready: false,
  passed: false,
  issues: ["missing_phase0_results"]
});
expect(output.gates_passed).toBe(false);
expect(output.trust_status).toBe("review_required");
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 新测试得到当前的 `locked`，且 `validation` 为 `undefined`。

### Task 2: 建立批次执行证据模块

**Files:**
- Create: `tests/phase0-evidence.test.ts`
- Create: `scripts/phase0-evidence.ts`

- [x] **Step 1: 写证据状态的失败测试**

直接测试期望 API：

```ts
const evidence = await loadPhase0ValidationEvidence(reportsDir, new Set(reportIds));
```

覆盖五类行为：

```ts
expect(missing).toMatchObject({
  available: false,
  ready: false,
  passed: false,
  issues: ["missing_phase0_results"]
});

expect(valid).toMatchObject({
  available: true,
  ready: true,
  passed: true,
  sample_count: 5,
  source_counts: {
    "claude-code-jsonl": 2,
    "openai-jsonl": 1,
    "codex-jsonl": 2
  }
});

expect(insufficientCoverage.ready).toBe(false);
expect(insufficientCoverage.issues).toContain("insufficient_samples");

expect(reportMismatch.ready).toBe(false);
expect(reportMismatch.issues).toContain("report_set_mismatch");

expect(executionFailure).toMatchObject({ ready: true, passed: false });
expect(executionFailure.issues).toContain("compress_success_rate_below_gate");
```

测试 fixture 中放入私有路径和错误文本，并断言 `JSON.stringify(evidence)` 不包含它们。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-evidence.test.ts`

Expected: 导入失败，因为证据模块尚不存在。

- [x] **Step 3: 实现固定门槛和只读证据加载**

创建 `scripts/phase0-evidence.ts`：

```ts
export const PHASE0_VALIDATION_GATES = {
  minimum_samples: 5,
  minimum_source_samples: {
    "claude-code-jsonl": 2,
    "openai-jsonl": 1,
    "codex-jsonl": 2
  },
  analyze_success_rate: 0.95,
  report_success_rate: 0.95,
  compress_success_rate: 0.95,
  input_mutations: 0
} as const;

export async function loadPhase0ValidationEvidence(
  reportsDir: string,
  actualReportIds: Set<string>
): Promise<ValidationEvidence> {
  // Read phase0-results.json, validate fixed schema, recompute counts,
  // compare aggregate and report sets, then classify readiness and quality.
}
```

实现要求：

- 只读 `join(reportsDir, "phase0-results.json")`。
- missing/unreadable/invalid JSON 使用固定 issue code，不回显路径或内容。
- 从 `results[]` 重算四项计数和三项来源计数。
- 成功 report 的 basename 必须以 `.report.json` 结尾且 ID 唯一。
- aggregate 必须与重算计数一致。
- expected/actual report 集合必须完全相等。
- readiness issues 与 quality issues 分开计算，再合并为排序稳定的 `issues`。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/phase0-evidence.test.ts`

Expected: 证据模块全部测试通过，输出不含 fixture 私有值。

### Task 3: 合并批次证据与人工审查 gate

**Files:**
- Modify: `tests/phase0-review.test.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: 为既有人工 gate 用例补完整批次证据**

在测试 helper 中为需要测试人工指标的用例写 5 份匹配报告与结果：

```ts
await writeCompleteValidationEvidence(reportsDir, [
  ["sample", "claude-code-jsonl"],
  ["claude-extra", "claude-code-jsonl"],
  ["openai", "openai-jsonl"],
  ["codex-a", "codex-jsonl"],
  ["codex-b", "codex-jsonl"]
]);
```

四个额外报告使用空 `messages`，避免改变当前用例的人工指标。保留一个完整证据 + 完整标签返回 `locked` 的用例，并新增完整覆盖但 compress 成功率不足返回 `failed` 的集成用例。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 单报告缺证据用例仍错误 locked，或新 validation/执行失败断言不存在。

- [x] **Step 3: 接入证据模块并调整状态机**

在加载 reports 后调用：

```ts
const validation = await loadPhase0ValidationEvidence(reportsDir, new Set(reports.keys()));
const gates = evaluateGates(metrics, validation);
```

输出新增：

```ts
schema_version: "trimctx.phase0.review.v2",
gates: {
  ...MANUAL_REVIEW_GATES,
  validation: PHASE0_VALIDATION_GATES
},
validation
```

同时移除 v1 顶层 `reports_dir` / `labels_dir`，避免 privacy-narrowed review 工件继续携带绝对路径。

状态机按设计实现：

```ts
if (!validation.ready || manualReviewIncomplete) {
  return { passed: false, status: "review_required" };
}
const passed = validation.passed && manualMetricsPass;
return { passed, status: passed ? "locked" : "failed" };
```

Markdown 增加 `## Validation Evidence` 表，使用 `n/a` 表示空 rate，只展示聚合值和固定 issue codes。

- [x] **Step 4: 运行 Phase 0 聚焦测试确认 GREEN**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-summary.test.ts`

Expected: 证据解析、最终 gate 和 run summary 全部通过。

### Task 4: 同步 Phase 0 文档和状态

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 明确自动证据关联**

说明 `phase0:review` 自动读取 reports 同目录的 `phase0-results.json`，missing/invalid/mismatch/coverage 不足时为 `review_required`，完整批次的执行门失败时为 `failed`，只有批次和人工门都通过才是 `locked`。

- [x] **Step 2: 记录已修复的误锁风险**

状态文档和 CHANGELOG 记录原脚本可在单报告下锁定、当前 report 集合关联与隐私输出边界，以及不改变 scorer/threshold 的事实。

- [x] **Step 3: 文档一致性检查**

Run: `rg -n "phase0-results|review_required|trust_status|locked" docs/dev/phase0 docs/dev/status-and-next-steps.md CHANGELOG.md`

Expected: 命令行不新增 `--results`，所有锁定说明都同时要求批次证据和人工证据。

### Task 5: 完整质量门

**Files:**
- Verify only

- [x] **Step 1: 聚焦测试与 build**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-summary.test.ts`

Expected: 全部通过。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 2: 全量测试**

Run: `npm test`

Expected: 0 failures。

- [x] **Step 3: 发布与工作区检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: packed-install/fresh-install smoke 通过，开发脚本不进入包。

Run: `npm pack --dry-run --json --silent`

Expected: 仍为 22 个既有发布文件。

Run: `git diff --check`

Expected: 无 whitespace errors，仅允许既有 LF/CRLF 提示；无 `.tgz` 或私有 Phase 0 输出残留。
