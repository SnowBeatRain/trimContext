# Phase 0 输入证据绑定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 约束 results v2 的 input hash/boolean 一致性，并把成功 result sample 与实际 report `input.file` 绑定，阻止局部 evidence 漂移错误锁定 trust。

**Architecture:** `phase0-evidence.ts` 在 normalization 阶段验证 sample 和 before/after SHA-256，派生并核对 unchanged 语义；`phase0-review.ts` 从已解析 report 提取 input file，与 digest/source 一起传入 evidence。review v2 只增加聚合匹配数和固定 issue。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、SHA-256、JSON/JSONL

---

### Task 1: 复现输入 evidence 缺口

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-evidence.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 将合法 fixtures 改为真实 SHA-256**

所有 results v2 fixture 使用 64 位 lowercase digest，before/after 与 `input_unchanged` 保持一致；report artifacts 增加实际 `inputFile`。

- [x] **Step 2: 写 hash/boolean 矛盾回归**

构造 before/after 不同但 `input_unchanged:true` 且 aggregate 已同步的 evidence，断言固定 `invalid_phase0_results`，输出不含私有 digest 哨兵。

- [x] **Step 3: 写 sample/report input mismatch 单元回归**

保持 ID/hash/source 全匹配，只替换一个 artifact inputFile。断言 `matched_report_inputs` 为 4、包含 `report_input_mismatch`，不输出错误路径。

- [x] **Step 4: 写 review 错误 locked 集成回归**

让五份 results sample 与实际 report input 都不同，其他执行、hash、source、label gate 完整。断言从旧 `locked` 降为 `review_required`、input 匹配 0/5，JSON/Markdown 不含路径。

- [x] **Step 5: 运行测试确认 RED**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

### Task 2: 实现输入证据绑定

**Files:**
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`
- Test: `tests/phase0-evidence.test.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 收紧 results v2 normalization**

要求非空 sample、合法 before/after digest，并校验 `input_unchanged === (before === after)`。规范化只保留隐私安全派生状态。

- [x] **Step 2: 扩展 report artifact inputFile**

从同一 report 解析对象读取 `input.file`，不回显非法值或路径。

- [x] **Step 3: 计算 input 匹配与固定 issue**

增加 `matched_report_inputs`，成功 report 的 expected sample 与 actual inputFile 不同则加入 `report_input_mismatch`。Markdown 增加聚合行。

- [x] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npx vitest run --testTimeout=30000 tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts`

### Task 3: 同步输入证据文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 digest/boolean 和 sample/report input 门**

区分 genuine mutation、invalid evidence 与 report input mismatch 的状态语义。

- [x] **Step 2: 记录隐私和威胁边界**

review 不重读 transcript，不输出路径或 digest；合法 results v2 无需迁移，机制不是数字签名。

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

确认六份 fixture 的 results before/after digest 合法且一致，report input/source/hash 全部匹配，输入不变；清理临时工件。

- [x] **Step 5: 工作区卫生检查**

Run: `git diff --check`

确认 `.tgz` 与本轮临时目录残留为 0，不触碰 `.vscode/`。

本计划按用户已有授权在当前工作区执行，不提交、不推送、不建 PR、不修改真实 transcript、不派生子代理。
