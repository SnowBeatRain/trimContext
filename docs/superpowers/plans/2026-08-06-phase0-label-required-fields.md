# Phase 0 Label Required Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止缺失/非法 decision 或无有效 review note 的人工 label 错误锁定 Phase 0 trust。

**Architecture:** 保留现有 label loader 与引用校验边界，在 `NormalizedLabel` 中只携带 normalized decision 和 note-valid 布尔事实。`validateLabels()` 聚合两个新增计数并加入现有 `label_quality_issues`；Markdown 只显示数字。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSONL

---

### Task 1: 复现 required-field 绕过并实现质量门

**Files:**
- Modify: `tests/phase0-review.test.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: 写错误 locked 回归**

在 `tests/phase0-review.test.ts` 新增完整 batch 用例。主 report 包含一个 remove candidate 与一个 critical protected message；remove label 的 decision 为 `private-invalid-label-decision` 且 note 有效，protected label 的 decision 合法但 note 只有空白：

```ts
expect(output.trust_status).toBe("review_required");
expect(output.gates_passed).toBe(false);
expect(output.metrics).toMatchObject({
  label_quality_issues: 2,
  invalid_label_decisions: 1,
  missing_review_notes: 1
});
expect(json).not.toContain("private-invalid-label-decision");
expect(summary).not.toContain("private-invalid-label-decision");
expect(summary).toContain("| Invalid label decisions | 1 |");
expect(summary).toContain("| Missing review notes | 1 |");
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 旧实现返回 `locked`，且 metrics/Markdown 缺少新增字段。

- [x] **Step 3: 实现最小 label-quality 聚合**

修改 `NormalizedLabel`：

```ts
interface NormalizedLabel {
  sample_id: string;
  message_id: string;
  decision?: Decision;
  label: ReviewLabel;
  has_review_note: boolean;
}
```

`normalizeLabel()` 使用 `stringField(record.review_note) !== undefined` 生成布尔值，不保存 note 正文。`validateLabels()` 初始化并逐 label 计算：

```ts
let invalidLabelDecisions = 0;
let missingReviewNotes = 0;

if (label.decision === undefined) invalidLabelDecisions += 1;
if (!label.has_review_note) missingReviewNotes += 1;
```

返回值必须为：

```ts
{
  label_quality_issues:
    unknownReferences
    + duplicateLabels
    + decisionMismatches
    + invalidLabelDecisions
    + missingReviewNotes,
  unknown_label_references: unknownReferences,
  duplicate_labels: duplicateLabels,
  decision_mismatches: decisionMismatches,
  invalid_label_decisions: invalidLabelDecisions,
  missing_review_notes: missingReviewNotes
}
```

在 Markdown `Label Quality` 表末尾增加固定数字行，不输出任何 label 值或 note。

- [x] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-review.test.ts tests/phase0-review-output-failure.test.ts tests/phase0-evidence.test.ts`

Expected: 19/19 passed。

### Task 2: 文档与质量门

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 同步 label required-field 语义**

说明 decision 与 review note 是 trust gate 必填字段；非法/缺失值输出聚合数字并强制 `review_required`；不宣称完整 label schema validation，不回显值或 note；现有引用、重复、mismatch、指标和阈值不变。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 43 个测试文件、376 项测试通过。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行发布与卫生检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件，新增 spec/plan 不进入包，无 `.tgz`、私有 Phase 0 工件或 `.vscode`。

Run: `git diff --check`

Expected: exit 0，仅有既有 LF -> CRLF 提示。
