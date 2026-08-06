# Candidate Reason Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止没有可审计理由的 remove/compress candidate 被写入完整报告或通过 Phase 0 trust gate。

**Architecture:** `src/core/report-review.ts` 负责类型化报告构造时的不变量，`scripts/phase0-review.ts` 独立验证持久化 JSON artifact。Phase 0 只增加一个固定聚合指标并复用现有 `report_quality_issues > 0` 门，不改变 scorer、threshold 或 compression。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL

---

### Task 1: 复现核心报告层缺口

**Files:**
- Modify: `tests/reporter.test.ts`
- Test: `src/core/report-review.ts`

- [x] **Step 1: 写 compress candidate 空 reasons 回归**

构造具有 medium decisive evidence 的 `compress_candidate`，但将 `reasons` 留空：

```ts
const invalid = analyzedMessage("m11", []);
invalid.decision = "compress_candidate";
invalid.analysis = analysisEvidence("m11", "obsolete_tool_output", undefined, "medium");

expect(() => createReport([invalid], "session.jsonl")).toThrow(
  /compress_candidate .* at least one reason/i
);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/reporter.test.ts`

Expected: 新用例失败，因为旧实现只校验 `remove_candidate` reasons。

### Task 2: 复现 Phase 0 持久化证据缺口

**Files:**
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 写原本可锁定报告的候选理由回归**

主报告保留有 reason 的 remove candidate 和 critical protected message，并增加空 reasons 的 compress candidate：

```ts
messages: [
  { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
  { id: "private-compress-id", decision: "compress_candidate", protected: false, reasons: [], rot_score: 0.7 },
  { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
]
```

断言 `missing_candidate_reasons: 1`、`report_quality_issues: 1`、`trust_status: "review_required"`，并确认 JSON/Markdown 不包含私有 ID。

- [x] **Step 2: 给既有合法候选 fixtures 补 reasons**

所有不以缺失 reason 为测试目标的 `remove_candidate` fixture 增加：

```ts
reasons: ["duplicate_message"]
```

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 新用例仍得到 `locked`，且 metrics 没有 `missing_candidate_reasons`。

### Task 3: 实现双层候选理由校验

**Files:**
- Modify: `src/core/report-review.ts`
- Modify: `scripts/phase0-review.ts`
- Test: `tests/reporter.test.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 收紧核心构造不变量**

在 remove 专用 protected/decisive-evidence 检查前，对两类候选执行：

```ts
if ((message.decision === "remove_candidate" || message.decision === "compress_candidate")
    && message.reasons.length === 0) {
  throw new Error(`${message.decision} ${message.id} must have at least one reason`);
}
```

remove candidate 的 protected 与 high-confidence decisive evidence 检查保持原样。

- [x] **Step 2: 增加 Phase 0 聚合指标**

在 `validateReports()` 中增加 `missingCandidateReasons`。decision 合法且属于候选时，只有非空 reasons array 才通过：

```ts
if ((decision === "remove_candidate" || decision === "compress_candidate")
    && (!Array.isArray(message.reasons) || message.reasons.length === 0)) {
  missingCandidateReasons += 1;
}
```

把该计数加入 `report_quality_issues`、JSON metrics 和 Markdown `Report Quality` 表。

- [x] **Step 3: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/reporter.test.ts tests/phase0-review.test.ts`

Expected: 两个新增回归和既有用例全部通过。

### Task 4: 同步契约文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 更新候选理由契约**

把验收描述明确为每条 `remove_candidate` 和 `compress_candidate` 都有 reasons，并说明无理由候选属于 report-quality issue、会保持 `review_required`。

- [x] **Step 2: 记录兼容边界**

说明这是报告/证据完整性收紧，不改变 scorer、threshold、protected、压缩或合法报告的人工安全门。

### Task 5: 完整验证

**Files:**
- Verify: `tmp-real-validation/report-v2-audit/*.report.json`

- [x] **Step 1: 运行全量测试与构建**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 2: 运行发布质量门**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: packed/fresh-install 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件，无 `.tgz`、`.vscode` 或私有验证工件。

- [x] **Step 3: 复核真实报告和 transcript 不变性**

对四份 Report v2 审计文件统计 remove/compress candidates 与缺失 reasons，只输出聚合数字；重新计算报告与输入 SHA-256，必须和修改前基线一致。

- [x] **Step 4: 检查工作区卫生**

Run: `git diff --check`

Expected: 没有新增 whitespace error；允许记录工作区既有 LF -> CRLF warning。

本计划按用户授权在当前会话内直接执行，不创建提交、不推送，也不派生子代理。
