# Phase 0 Report 来源绑定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Phase 0 来源覆盖绑定到实际审查 report 的 `input.source`，阻止 results v2 的错误来源声明绕过多来源发布门。

**Architecture:** `phase0-review.ts` 从已解析 report 提取 source 并与 digest 一起传给 `phase0-evidence.ts`；evidence 按成功 report ID 比较 results source 与实际 source，用实际成功 report 计算覆盖，并输出隐私安全的匹配计数和固定 issue。results v2、人工指标与产品行为保持不变。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL

---

### Task 1: 复现来源覆盖错绑

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-evidence.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 扩展合法 test artifact fixture**

让 evidence helper 为每个实际 artifact 提供 digest 与 source；让 review helper 写入与 results 声明一致的 Report v2 `input.source`，保持现有合法用例语义。

- [x] **Step 2: 写 evidence source mismatch 回归**

保留 report ID/hash 全匹配，替换一个实际 source。断言 evidence 不 ready，`matched_report_sources` 降低，包含 `report_source_mismatch` 和对应来源覆盖不足，序列化结果不含非法 source 哨兵。

- [x] **Step 3: 写 review 错误 locked 集成回归**

results 声明 2 Claude、1 OpenAI、2 Codex，实际五份 report 都声明 Claude。提供可通过的完整人工标签，断言新行为为 `review_required`、source 匹配 2/5，Markdown 只含聚合数和固定 issue。

- [x] **Step 4: 运行测试确认 RED**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

Expected: 新 source mismatch 断言因当前 evidence 不读取实际 source 而失败。

### Task 2: 实现 artifact source binding

**Files:**
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`
- Test: `tests/phase0-evidence.test.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 引入 report artifact 最小类型**

把实际 report map 从 digest string 改为 `{ sha256, source }`，empty evidence 增加 `matched_report_sources: 0`。

- [x] **Step 2: 对账 source 并重算覆盖**

按成功 report ID 比较 result source 与实际受支持 source；source counts 只统计这些期望 ID 的实际合法 source。不匹配加入 `report_source_mismatch`。

- [x] **Step 3: 扩展 review loader 与 Markdown**

从同一 report 解析对象读取 `input.source`，与同一 Buffer 的 digest 一起传给 evidence。Validation Evidence 表增加 `Report sources matched` 聚合行。

- [x] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts`

### Task 3: 同步证据契约文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录来源匹配门和覆盖语义**

说明每个成功 report 的 results source 必须匹配实际 report `input.source`，来源覆盖按实际成功 report 计算，review 输出 `matched_report_sources`。

- [x] **Step 2: 记录隐私与兼容边界**

固定 issue 不回显 source 原值或路径；results v2 无需迁移；不改变产品 CLI、评分、压缩或 Phase 0 未锁定声明。

### Task 4: 完整验证

**Files:**
- Verify: `scripts/phase0-evidence.ts`
- Verify: `scripts/phase0-review.ts`
- Verify: `tests/phase0-evidence.test.ts`
- Verify: `tests/phase0-review.test.ts`

- [x] **Step 1: 运行 Phase 0 聚焦测试**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts`

- [x] **Step 2: 运行全量测试与构建**

Run: `npm test`

Run: `npm run build`

- [x] **Step 3: 运行发布质量门**

Run: `npx vitest run --testTimeout=30000 tests/package-contents.test.ts`

Run: `npm pack --dry-run --json --silent`

Expected: packed/fresh-install 5/5，发布文件仍为 22，禁入项为 0。

- [x] **Step 4: 运行 sanitized Phase 0 端到端验证**

使用六份 `tests/fixtures/*.jsonl` 运行真实 `phase0:run`，确认 6/6 source/input/hash 匹配且输入不变；为最小标签集运行 review 或用集成测试确认 source mismatch 只产生固定聚合输出。清理本轮临时目录。

- [x] **Step 5: 检查工作区卫生**

Run: `git diff --check`

确认本轮临时目录和 `.tgz` 残留为 0，且 `.vscode/` 未被触碰。

本计划按用户已有授权在当前工作区直接执行，不创建提交、不推送、不建 PR、不修改真实 transcript、不派生子代理。
