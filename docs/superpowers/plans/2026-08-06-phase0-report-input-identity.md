# Phase 0 Report 输入身份绑定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Phase 0 analyze/report 的成功状态绑定到当前 batch 样本，阻止另一输入生成的合法 Report v2 被错误计入证据。

**Architecture:** 在 `phase0-run-sample.ts` 的最小 Report v2 结构校验之后，精确比较 report 的 `input.file` 与 `Phase0SamplePlan.inputFile`。身份失败沿用命令级 contract failure，不返回 metadata；report 身份失败也不生成 SHA-256。results v2 和 review evidence schema 不变。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、JSON/JSONL

---

### Task 1: 复现 analyze/report 输入错绑

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Test: `scripts/phase0-run-sample.ts`

- [x] **Step 1: 写 analyze 错绑回归**

让 analyze stdout 返回属于另一绝对路径的合法 Report v2，report artifact 返回当前样本报告。断言 analyze 为失败、错误为固定文案、report 仍成功、metadata 来自 report，序列化结果不含错误输入路径。

- [x] **Step 2: 写 report 错绑回归**

让 report artifact 返回属于另一绝对路径的合法 Report v2，analyze stdout 返回当前样本报告。断言 report 为失败且不含 `report_sha256`、analyze 仍成功、metadata 来自 analyze，序列化结果不含错误输入路径。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-run-sample.test.ts`

Expected: 两条新回归因 analyze/report 仍接受错误 `input.file` 而失败。

### Task 2: 实现输入身份校验

**Files:**
- Modify: `scripts/phase0-run-sample.ts`
- Test: `tests/phase0-run-sample.test.ts`

- [x] **Step 1: 将当前输入传入两个 validator**

调用改为：

```ts
validateAnalyzeResult(analyze, inputFile)
validateReportArtifact(reportProcess, reportFile, inputFile)
```

- [x] **Step 2: 在最小契约之后精确比较输入路径**

analyze 不匹配时使用固定错误 `Analyze report input does not match the sample`。report 不匹配时使用 `Report artifact input does not match the sample: ${reportFile}`。两者均不返回 `parsed`，report 也不返回 hash。

- [x] **Step 3: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-run-sample.test.ts`

Expected: 全部通过。

### Task 3: 同步 Phase 0 契约文档

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录输入身份门**

说明 analyze/report 的合法 Report v2 必须声明与当前 batch 样本精确相同的 `input.file`；失败只影响对应命令，report 不产生 hash，metadata fallback 保持。

- [x] **Step 2: 记录边界**

明确使用 Phase 0 已传入的绝对路径字符串，不引入 `realpath` 或宽松比较；不改变评分、压缩、公开命令和原 transcript 只读契约，也不表示 Phase 0 已锁定。

### Task 4: 完整验证

**Files:**
- Verify: `scripts/phase0-run-sample.ts`
- Verify: `tests/phase0-run-sample.test.ts`

- [x] **Step 1: 运行 Phase 0 聚焦测试**

Run: `npx vitest run tests/phase0-run-sample.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

- [x] **Step 2: 运行全量测试与构建**

Run: `npm test`

Run: `npm run build`

- [x] **Step 3: 运行发布质量门**

Run: `npx vitest run tests/package-contents.test.ts`

Run: `npm pack --dry-run --json --silent`

Expected: packed/fresh-install smoke 通过，发布清单仍为 22 files 且无私有临时 artifact。

- [x] **Step 4: 运行真实 CLI 最小 Phase 0 smoke**

在项目内临时目录复制 sanitized fixtures，执行 `npm run phase0:run -- --input <fixtures> --output <output>`，确认全部 report 输入身份与样本相同、report hash 匹配磁盘字节、输入 hash 不变。删除本轮临时目录。

- [x] **Step 5: 检查工作区卫生**

Run: `git diff --check`

Expected: 无新增 whitespace error；只允许既有 LF -> CRLF warning。确认无 `.tgz` 或本轮临时目录残留。

本计划按用户已有授权在当前工作区执行，不创建提交、不推送、不建 PR、不修改真实 transcript、不触碰 `.vscode/`，也不派生子代理。
