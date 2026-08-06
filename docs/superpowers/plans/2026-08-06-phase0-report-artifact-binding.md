# Phase 0 Report Artifact Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用精确字节 SHA-256 将 Phase 0 batch 已验证 report 与人工 review 实际读取 artifact 绑定，阻止同名替换报告错误锁定 trust。

**Architecture:** `phase0-run-sample.ts` 从已验证 Buffer 产生 digest，`phase0-run.ts` 输出 `trimctx.phase0.results.v2`。`phase0-review.ts` 从实际解析 Buffer 产生 digest map，`phase0-evidence.ts` 比较 results v2 的预期 ID/hash 与实际 ID/hash，并只输出聚合匹配数和固定 issue code。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、SHA-256、JSON/JSONL

---

### Task 1: 复现 run 缺失 report digest

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Test: `scripts/phase0-run-sample.ts`

- [x] **Step 1: 写精确字节 digest 回归**

生成带缩进和结尾换行的合法 report bytes，执行 `validatePhase0Sample()`，断言：

```ts
expect(result.report.report_sha256).toBe(
  createHash("sha256").update(reportContents).digest("hex")
);
```

并在失败 report artifact 用例断言：

```ts
expect(result.report).not.toHaveProperty("report_sha256");
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-run-sample.test.ts`

Expected: 成功结果没有 `report_sha256`，新增断言失败。

### Task 2: 复现 evidence 同名替换缺口

**Files:**
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`
- Test: `scripts/phase0-evidence.ts`
- Test: `scripts/phase0-review.ts`

- [x] **Step 1: 把合法 evidence fixtures 升级到 v2**

`ResultFixture.report` 增加 `report_sha256`，schema 改为 `trimctx.phase0.results.v2`。直接 evidence 测试传入：

```ts
new Map(results.map((result) => [
  basename(result.report.report_file, ".report.json"),
  result.report.report_sha256
]))
```

review 集成 helper 从每份真实 fixture report bytes 计算期望 digest。

- [x] **Step 2: 写同 ID/hash mismatch 回归**

构造五样本完整 evidence，实际 map 保留相同五个 ID，但替换一个 digest。断言：

```ts
expect(evidence).toMatchObject({
  ready: false,
  passed: false,
  matched_reports: 5,
  matched_report_hashes: 4,
  issues: ["report_hash_mismatch"]
});
```

- [x] **Step 3: 写旧 schema 与缺 hash 回归**

旧 v1 evidence 必须返回 `report_integrity_unavailable`；v2 成功 report 缺失 hash 必须返回 `invalid_phase0_results`。

- [x] **Step 4: 写 review 替换 artifact 回归**

先对可锁定报告写完整 evidence，再覆盖同一文件、只增加私有顶层字段。断言 `trust_status: "review_required"`、Markdown 包含 `report_hash_mismatch`，JSON/Markdown 均不包含私有字段值。

- [x] **Step 5: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-run-sample.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

Expected: digest 字段、hash mismatch metric/issue、v1 migration 和 review 替换用例因功能缺失而失败。

### Task 3: 实现 results v2 和 digest 生成

**Files:**
- Modify: `scripts/phase0-run-sample.ts`
- Modify: `scripts/phase0-run.ts`
- Test: `tests/phase0-run-sample.test.ts`

- [x] **Step 1: 从 report validation Buffer 返回 digest**

把 report 读取改为 Buffer，并在 contract 成功后返回：

```ts
return {
  result,
  parsed,
  sha256: createHash("sha256").update(contents).digest("hex")
};
```

`Phase0SampleResult.report` 增加可选 `report_sha256`，最终结果透传 `reportValidation.sha256`。

- [x] **Step 2: 升级 results schema**

`scripts/phase0-run.ts` 输出：

```ts
schema_version: "trimctx.phase0.results.v2"
```

- [x] **Step 3: 运行 run 聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-run-sample.test.ts tests/phase0-summary.test.ts tests/phase0-run-safety.test.ts`

Expected: 全部通过，现有 input/compress/transaction 行为不变。

### Task 4: 实现 review 同字节重算和 evidence 比较

**Files:**
- Modify: `scripts/phase0-review.ts`
- Modify: `scripts/phase0-evidence.ts`
- Test: `tests/phase0-evidence.test.ts`
- Test: `tests/phase0-review.test.ts`

- [x] **Step 1: 让 loadReports 返回 messages 与 digest maps**

每份 report 使用一次 `readFile(file)` Buffer，同时解析和计算 digest：

```ts
const contents = await readFile(file);
parsed = JSON.parse(contents.toString("utf8"));
reportSha256ById.set(sampleId, createHash("sha256").update(contents).digest("hex"));
```

- [x] **Step 2: 收紧 results v2 normalization**

成功 report 必须有合法摘要：

```ts
const SHA256 = /^[a-f0-9]{64}$/;
if (!SHA256.test(value.report.report_sha256)) return undefined;
```

v1 顶层 schema 单独映射为 `report_integrity_unavailable`，其他非法结构映射为 `invalid_phase0_results`。

- [x] **Step 3: 比较 ID/hash 并扩展隐私安全摘要**

`ValidationEvidence` 增加 `matched_report_hashes`。同 ID 摘要不同加入 `report_hash_mismatch`；Markdown `Validation Evidence` 增加固定聚合行，不输出摘要值。

- [x] **Step 4: 运行 Phase 0 聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-run-sample.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-summary.test.ts tests/phase0-run-safety.test.ts`

Expected: 新增回归和现有 Phase 0 行为测试全部通过。

### Task 5: 同步证据契约文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 results v2 迁移与 hash gate**

说明成功 report 的 `report_sha256` 必填、v1 需要重跑、ID/hash 都匹配才可锁定。

- [x] **Step 2: 记录威胁边界**

明确 byte-exact 漂移检测不等于数字签名或对抗同时修改 evidence/report 的攻击者；不改变评分、压缩和公开 CLI。

### Task 6: 完整验证

**Files:**
- Verify: `scripts/phase0-*.ts`
- Verify: `tests/phase0-*.test.ts`

- [x] **Step 1: 运行全量测试与构建**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 2: 运行发布质量门**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: packed/fresh-install 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件且无私有/临时 artifact。

- [x] **Step 3: 运行最小端到端 Phase 0 证据验证**

在临时目录运行真实 `phase0:run`，确认 results v2 的成功 report hash 与磁盘字节一致；复制完整五样本 fixture 或用集成测试确认修改 report 后 review 返回 `review_required` 且只输出固定 issue。

- [x] **Step 4: 检查工作区卫生**

Run: `git diff --check`

Expected: 无新增 whitespace error；仅允许既有 LF -> CRLF warning。

本计划按用户既有授权在当前工作区直接执行，不创建提交、不推送、不建 PR、不派生子代理。
