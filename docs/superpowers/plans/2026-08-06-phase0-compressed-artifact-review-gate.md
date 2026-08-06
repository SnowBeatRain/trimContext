# Phase 0 Compressed Artifact Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Phase 0 review 独立复核成功 compress 的实际 artifact 集合与可读性，并验证 `failed_samples` 聚合和逐样本结果一致。

**Architecture:** `phase0-review.ts` 从 reports 目录枚举可用 `.trimmed.jsonl` ID；`phase0-evidence.ts` 从 results v2 规范化 expected compressed IDs、匹配集合并校验重复项与 failed sample 列表。review 输出只增加聚合数和固定 issue，不读取 compressed 正文。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL、Node fs/promises

---

### Task 1: 复现 compressed artifact 与 aggregate 缺口

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-evidence.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 扩展 results/compressed fixtures**

`ResultFixture.compress` 增加 `output_file`，helper 从所有 `compress.ok` result 生成 expected actual ID set。review helper 为每个成功 compress 写入最小 `.trimmed.jsonl`，真实失败不写。

- [x] **Step 2: 写 compressed set mismatch 单元回归**

从 actual set 删除 `openai` 并加入私有 stale ID。断言：

```ts
expect(evidence).toMatchObject({
  ready: false,
  expected_compressed_artifacts: 5,
  matched_compressed_artifacts: 4
});
expect(evidence.issues).toContain("compressed_set_mismatch");
```

序列化 evidence 不包含两个 artifact ID。

- [x] **Step 3: 写 failed_samples mismatch 回归**

逐样本全部成功，但 aggregate 写入一个私有 failed path。断言 `aggregate_mismatch` 且 evidence 不回显该路径。

- [x] **Step 4: 写 review 缺失 compressed artifacts 集成回归**

构造原本可锁定的五份 report/label/results，但不写 `.trimmed.jsonl`。断言旧 `locked` 被新行为降为 `review_required`，匹配 0/5，Markdown 只有固定 issue 和数字。

- [x] **Step 5: 写重复 sample/compressed ID 回归**

分别构造重复 sample path 与不同 output path 但相同 `.trimmed.jsonl` basename，断言 `duplicate_samples` / `duplicate_compressed_ids`。

- [x] **Step 6: 运行测试确认 RED**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

Expected: 新用例因 review/evidence 尚未消费 compressed artifact 和 failed_samples 而失败；既有用例保持。

### Task 2: 实现 compressed artifact review gate

**Files:**
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`
- Test: `tests/phase0-evidence.test.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 规范化 compressed output ID**

成功 compress 必须有合法 `.trimmed.jsonl` output path；保存 basename ID，生成 expected list/set 和 matched count。

- [x] **Step 2: 校验集合与重复项**

增加 `duplicate_samples`、`duplicate_compressed_ids` 和 `compressed_set_mismatch`，并输出 expected/matched compressed artifact 数。

- [x] **Step 3: 校验 `aggregate.failed_samples`**

按 run 的失败定义和 results 顺序重算数组，纳入 `aggregateMatches()` 的精确比较。

- [x] **Step 4: review 扫描普通且可读 compressed 文件**

复用一次目录枚举；仅将 `isFile()` 且 open/close 成功的 `.trimmed.jsonl` basename 加入 actual set，并传给 evidence。

- [x] **Step 5: 扩展 Markdown 聚合行**

Validation Evidence 增加：

```text
Compressed artifacts matched | <matched>/<expected>
```

- [x] **Step 6: 运行聚焦测试确认 GREEN**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts`

### Task 3: 同步 Phase 0 文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 compressed 集合/可读性门**

说明成功 compress 只有在 review 时实际 artifact 集合完全匹配才可参与锁定；缺失、额外、非普通或不可读目标为 readiness issue。

- [x] **Step 2: 记录 aggregate 与非目标边界**

说明 `failed_samples` 精确重算；本门不读取内容、不记录 digest、不验证压缩语义、不改变 results v2 或产品行为。

### Task 4: 完整验证

- [x] **Step 1: Phase 0 聚焦测试**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts`

- [x] **Step 2: 全量测试与构建**

Run: `npm test`

Run: `npm run build`

- [x] **Step 3: 发布质量门**

Run: `npx vitest run --testTimeout=30000 tests/package-contents.test.ts`

Run: `npm pack --dry-run --json --silent`

- [x] **Step 4: sanitized Phase 0 端到端验证**

运行六份 fixture batch，确认 expected/matched compressed artifacts 为 6/6；移除一份临时 compressed artifact 后运行 review 集成回归或纯 evidence 检查，确认只产生固定聚合 issue。清理临时目录。

- [x] **Step 5: 工作区卫生检查**

Run: `git diff --check`

确认临时 smoke 目录和 `.tgz` 残留为 0，`.vscode/` 未被触碰。

本计划按用户已有授权在当前工作区 inline 执行；不提交、不推送、不建 PR、不修改真实 transcript、不派生子代理。
