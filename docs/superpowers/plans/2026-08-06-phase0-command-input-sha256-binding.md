# Phase 0 Command Input SHA-256 Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Phase 0 三条 CLI 子进程实际消费的输入 Buffer 绑定到首次记录的 SHA-256，并让旧 results v2 缺少新证据时无法锁定 trust。

**Architecture:** 新的纯输入完整性模块从内部环境变量读取期望摘要，并校验命令已经读取的同一 Buffer；runner 将每个 sample 的首次摘要注入三条子进程。results/review v2 增加兼容证据字段和聚合计数，不改变公开 CLI、Report v2、评分或压缩决策。

**Tech Stack:** Node.js 20+、TypeScript、commander、Vitest、SHA-256、JSON/JSONL

---

### Task 1: 用测试复现缺少命令输入绑定

**Files:**
- Modify: `tests/phase0-run-sample.test.ts`
- Modify: `tests/cli-commands.test.ts`
- Modify: `tests/phase0-summary.test.ts`
- Test: `scripts/phase0-run-sample.ts`
- Test: `src/core/pipeline.ts`
- Test: `src/commands/report.ts`
- Test: `src/core/compressor.ts`

- [x] **Step 1: 写 runner 摘要传递回归**

在 `tests/phase0-run-sample.test.ts` 增加一个 runner，记录第三个参数：

```ts
const expectedDigests: Array<string | undefined> = [];
const runCli: Phase0CliRunner = async (args, _timeoutMs, expectedInputSha256) => {
  expectedDigests.push(expectedInputSha256);
  // 继续写入现有最小 report/compressed fixtures。
  return { ok: true, exit_code: 0, stdout: args[0] === "analyze" ? JSON.stringify(report) : undefined };
};

expect(expectedDigests).toEqual([inputSha256, inputSha256, inputSha256]);
expect(result.input_sha256_bound).toBe(true);
```

- [x] **Step 2: 写三命令错误摘要集成回归**

在 `tests/cli-commands.test.ts` 对 `analyze --json`、`report` 和 `compress` 分别传入：

```ts
{ TRIMCTX_PHASE0_EXPECT_INPUT_SHA256: "0".repeat(64) }
```

断言退出非零、stderr 只包含 `Input changed during Phase 0 validation` 且不包含私有摘要；report/compress 的新目标不存在。再以真实输入摘要运行三条命令，断言现有 JSON/report/compressed 输出契约不变。

- [x] **Step 3: 写 summary 新聚合行回归**

在 `tests/phase0-summary.test.ts` 要求 results aggregate 和 Markdown 包含 `input_sha256_bound` 计数，例如：

```ts
expect(evidence.aggregate.input_sha256_bound).toBe(1);
expect(summary).toContain("| Command inputs SHA-256 bound | 1/1 |");
```

- [x] **Step 4: 运行 RED**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-run-sample.test.ts tests/cli-commands.test.ts tests/phase0-summary.test.ts
```

Expected: runner 第三个参数、`input_sha256_bound` 字段和内部输入摘要校验尚不存在，因此新增断言失败；既有用例继续通过。

### Task 2: 实现同一 Buffer 的 SHA-256 校验

**Files:**
- Create: `src/core/input-integrity.ts`
- Create: `tests/input-integrity.test.ts`
- Modify: `src/core/pipeline.ts`
- Modify: `src/commands/report.ts`
- Modify: `src/core/compressor.ts`
- Modify: `scripts/phase0-run-sample.ts`
- Test: `tests/cli-commands.test.ts`
- Test: `tests/phase0-run-sample.test.ts`

- [x] **Step 1: 写输入完整性纯函数用例**

覆盖缺少期望值、合法匹配、合法不匹配和非法期望值：

```ts
expect(() => assertPhase0InputSha256(input, undefined)).not.toThrow();
expect(() => assertPhase0InputSha256(input, digest(input))).not.toThrow();
expect(() => assertPhase0InputSha256(input, "0".repeat(64)))
  .toThrow("Input changed during Phase 0 validation");
expect(() => assertPhase0InputSha256(input, "private-invalid"))
  .toThrow("Invalid Phase 0 input SHA-256 expectation");
```

- [x] **Step 2: 实现纯输入完整性模块**

在 `src/core/input-integrity.ts` 实现：

```ts
import { createHash } from "node:crypto";

export const PHASE0_EXPECTED_INPUT_SHA256_ENV = "TRIMCTX_PHASE0_EXPECT_INPUT_SHA256";
const SHA256 = /^[a-f0-9]{64}$/;

export function assertPhase0InputSha256(
  input: Uint8Array,
  expected = process.env[PHASE0_EXPECTED_INPUT_SHA256_ENV]
): void {
  if (expected === undefined) return;
  if (!SHA256.test(expected)) {
    throw new Error("Invalid Phase 0 input SHA-256 expectation");
  }
  const actual = createHash("sha256").update(input).digest("hex");
  if (actual !== expected) {
    throw new Error("Input changed during Phase 0 validation");
  }
}
```

- [x] **Step 3: 在三条命令的实际 Buffer 边界校验**

`analyzeFile()` 用无编码 `readFile()` 取得 Buffer，校验后再解码。`report` 和 `compressFile()` 对各自现有 file handle 的 `readFile()` Buffer 执行同一校验，然后只从该 Buffer 解码、解析和生成输出。校验必须发生在任何目标写入之前。

- [x] **Step 4: 把首次摘要注入三个子进程**

把 runner 类型和真实实现改为：

```ts
export type Phase0CliRunner = (
  args: string[],
  timeoutMs: number,
  expectedInputSha256: string
) => Promise<Phase0CommandResult>;
```

`validatePhase0Sample()` 的三次调用都传 `beforeHash`。真实 `execFile` 选项增加：

```ts
env: {
  ...process.env,
  [PHASE0_EXPECTED_INPUT_SHA256_ENV]: expectedInputSha256
}
```

不得修改父进程环境，也不得把摘要放入 CLI 参数、stdout 或 Markdown。

- [x] **Step 5: 写 sample 绑定证据**

`Phase0SampleResult` 增加 `input_sha256_bound: true`，并在成功或失败命令场景都由新 runner 生成该标记。`isPhase0SampleOk()` 要求该字段为 `true`。

- [x] **Step 6: 运行 GREEN**

```powershell
npx vitest run --testTimeout=30000 tests/input-integrity.test.ts tests/phase0-run-sample.test.ts tests/cli-commands.test.ts
```

Expected: 新用例通过，错误摘要路径不创建 report/compressed 目标，普通和正确摘要路径保持原输出。

### Task 3: 绑定 results aggregate 与 review 兼容证据

**Files:**
- Modify: `scripts/phase0-run.ts`
- Modify: `scripts/phase0-evidence.ts`
- Modify: `scripts/phase0-review.ts`
- Modify: `tests/phase0-summary.test.ts`
- Modify: `tests/phase0-evidence.test.ts`
- Modify: `tests/phase0-review.test.ts`

- [x] **Step 1: 写旧 v2 unavailable 回归**

让一个结构完整的旧 results v2 fixture 缺少 sample `input_sha256_bound` 和 aggregate 字段，断言：

```ts
expect(evidence.input_sha256_bound).toBe(0);
expect(evidence.issues).toContain("input_sha256_binding_unavailable");
expect(evidence.ready).toBe(false);
```

- [x] **Step 2: 写非法 present 与 aggregate 漂移回归**

分别把 sample 字段改为 `false`/非布尔值、把 aggregate 改为范围外整数，再把 aggregate 改为范围内但与 sample 数量不同。前两类断言 `invalid_phase0_results`，计数漂移断言 `aggregate_mismatch`；JSON/Markdown 均不得包含私有摘要或 sample 路径。

- [x] **Step 3: 实现 runner aggregate**

`phase0-run.ts` 的 aggregate 增加：

```ts
input_sha256_bound: results.filter((result) => result.input_sha256_bound).length
```

Markdown aggregate 增加 `Command inputs SHA-256 bound` 行。

- [x] **Step 4: 实现 evidence normalization 和 readiness gate**

`ValidationResult` 保存 `inputSha256BindingPresent`；存在字段时只接受字面量 `true`。`ValidationEvidence` 增加 `input_sha256_bound` 计数。aggregate 字段存在时必须是范围内整数；它与计数不一致时沿用 `aggregate_mismatch`。任一新证据缺失时加入 `input_sha256_binding_unavailable`，但保持旧 v2 可读取。

- [x] **Step 5: 同步 review JSON/Markdown**

`phase0-review.ts` 在 validation 表中输出：

```text
| Command inputs SHA-256 bound | <matched>/<sample_count> |
```

不输出环境变量、摘要、路径或逐 sample 详情。

- [x] **Step 6: 运行 evidence/review GREEN**

```powershell
npx vitest run --testTimeout=30000 tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-sample.test.ts
```

Expected: 新 evidence 完整时 ready 语义保持；旧 v2 变为 `review_required`；非法 present 证据 fail closed。

### Task 4: 同步开发文档与版本记录

**Files:**
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录命令输入绑定保证**

说明首次摘要如何通过内部子进程环境绑定到 analyze/report/compress 实际 Buffer，校验和解析为何不会再次读取路径，以及末次摘要仍承担的职责。

- [x] **Step 2: 记录 results/review 兼容语义**

记录 sample/aggregate `input_sha256_bound`、review 聚合计数、`input_sha256_binding_unavailable`、旧 v2 需要重跑和非法 present 证据的失败语义。

- [x] **Step 3: 记录威胁与产品边界**

明确没有持久原文快照、没有签名或恶意全证据篡改防护，不改变 Report v2、scorer、threshold、candidate、compression、六命令或原 transcript 只读保证。

### Task 5: 完整验证与受控漂移

- [x] **Step 1: 运行聚焦测试**

```powershell
npx vitest run --testTimeout=30000 tests/input-integrity.test.ts tests/cli-commands.test.ts tests/phase0-run-sample.test.ts tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts tests/phase0-run-safety.test.ts
```

- [x] **Step 2: 运行严格 Phase 0 TypeScript 与 build**

用仓库既有 NodeNext/ES2022/strict/noEmit 命令检查全部 `scripts/phase0-*.ts`，然后运行：

```powershell
npm run build
```

- [x] **Step 3: 运行全量和发布质量门**

```powershell
npm test
npx vitest run --testTimeout=30000 tests/package-contents.test.ts
npm pack --dry-run --json --silent
git diff --check
```

Require: 零测试/build/diff 失败；packed/fresh-install 通过；包仍为 22 files；根目录 `.tgz` 为 0。

- [x] **Step 4: 运行 sanitized Phase 0 真实链路**

只在任务专用 `tmp-real-validation/phase0-command-input-binding-validation/` 中复制公开 sanitized fixtures。要求 6/6 `input_sha256_bound`、analyze/report semantic、report、compress、input unchanged、artifact hash/structure/message set 全部匹配，空 labels 仍为 `review_required`。

- [x] **Step 5: 运行 A/B/A 受控命令漂移**

在临时 fixture 上让 runner 首次摘要为 A、命令读取 B、末次恢复 A。要求至少一个子命令固定失败、`sample_ok: false`，错误不含 A/B 内容或摘要，且旧目标不被计为本轮成功 artifact。

- [x] **Step 6: 清理并审计范围**

只删除本任务临时目录。保留 `tmp-real-validation/report-v2-audit`、`.vscode/`、既有私有报告、产品压缩产物和原 transcript。扫描 `.tgz`、stage、backup、tamper、`.trimctx-*.tmp` 残留为 0。

本计划按用户已有授权在当前 dirty `main` 工作区 inline 执行。不提交、不推送、不创建 PR、不派生子代理、不修改 schema version 字符串、不触碰 `.vscode/` 或真实 transcript。
