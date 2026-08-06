# Phase 0 Report Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止重复、缺失或 malformed report message 通过缩小分母或复用 label 错误锁定 Phase 0 trust。

**Architecture:** 在 `phase0-review.ts` 内新增纯 `validateReports()` 聚合，只检查 trust gate 实际依赖的 message 字段。质量计数加入 v2 metrics 与 Markdown；gate 在 batch evidence 通过后同时要求 report/label quality 为零，不自动修复 artifact。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL

---

### Task 1: 复现重复 ID 错误 locked

**Files:**
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 写重复 remove-candidate ID 回归**

创建完整五样本 validation evidence；主 report 包含两个同 ID 的 `remove_candidate` 与一个高 rot protected message，只提供一条 safe-remove label 和一条 protected-keep label：

```ts
messages: [
  { id: "duplicate-remove", decision: "remove_candidate", protected: false, rot_score: 0.8 },
  { id: "duplicate-remove", decision: "remove_candidate", protected: false, rot_score: 0.8 },
  { id: "protected", decision: "keep_protected", protected: true, rot_score: 0.7 }
]
```

运行 review 后断言：

```ts
expect(output.trust_status).toBe("review_required");
expect(output.gates_passed).toBe(false);
expect(output.metrics).toMatchObject({
  report_quality_issues: 1,
  duplicate_message_ids: 1
});
```

Markdown 必须显示 `Report Quality` 聚合，不包含 `duplicate-remove`。

- [x] **Step 2: 写 malformed message 聚合回归**

主 report 加入 null record、空 ID、非法 decision、非 boolean protected、非 number rot score 和 protection mismatch，同时保留一个合法 remove 与一个合法 critical protected 供 labels 引用。断言七个质量字段分别为预期计数、总数为 6、状态为 `review_required`，JSON/Markdown 不包含私有测试 ID 或非法字段值。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 重复 ID case 旧实现返回 `locked` 且没有 report quality 字段；malformed case 在 null message 处失败，无法生成审计输出。

### Task 2: 实现 report artifact 质量聚合

**Files:**
- Modify: `scripts/phase0-review.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 让 report loops 对 unknown records 安全**

将 report map 的 message element 视为 `unknown`，新增：

```ts
function isReportMessage(value: unknown): value is ReportMessage {
  return isRecord(value);
}
```

`summarize()` 与 `validateLabels()` 遇到非对象时跳过字段访问；label map 对重复 ID 只保留首个 record。

- [x] **Step 2: 新增 validateReports()**

逐 sample 使用独立 `seenIds`，返回：

```ts
{
  report_quality_issues,
  invalid_message_records,
  missing_message_ids,
  duplicate_message_ids,
  invalid_message_decisions,
  invalid_protected_flags,
  invalid_rot_scores,
  inconsistent_protection_decisions
}
```

duplicate 每个首条后的 occurrence 计数；consistency 只在 decision/protected 各自有效时检查。总数必须等于各分类和。

- [x] **Step 3: 接入 metrics 与 gate**

`summarize()` 合并 report quality；`evaluateGates()` 的 review-required 条件改为：

```ts
if (
  metrics.report_quality_issues > 0
  || metrics.label_quality_issues > 0
  || !reviewComplete
  || metrics.remove_candidate_precision === null
  || metrics.protected_recall === null
) {
  return { passed: false, status: "review_required" };
}
```

batch not-ready/failed 优先级保持不变。

- [x] **Step 4: 增加隐私安全 Markdown 表**

在 `Label Quality` 前输出 `Report Quality` 表，逐项使用固定英文 label 和数字，不输出 ID、值、路径或正文。

- [x] **Step 5: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-review.test.ts tests/phase0-evidence.test.ts`

Expected: 新增两项与既有 batch/label/locked 回归全部通过。

### Task 3: 文档与完整质量门

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 report-quality trust 边界**

说明 report message 主键/字段质量异常为 `review_required`，输出只含聚合数字；不宣称完整 schema validation，也不改变合法报告阈值。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行发布与卫生检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件，无 `.tgz`、私有 Phase 0 工件或 `.vscode`。

Run: `git diff --check`

Expected: exit 0，仅有既有 LF -> CRLF 提示。
