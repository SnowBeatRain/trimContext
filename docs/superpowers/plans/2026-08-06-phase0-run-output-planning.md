# Phase 0 Run Output Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 `phase0:run` 因规范化文件名碰撞覆盖批次工件，并拒绝输入/输出指向同一真实目录。

**Architecture:** 新增无副作用的 `phase0-run-plan` 模块，集中计算现有输出名、检查批次唯一性并校验目录真实路径。`phase0-run.ts` 在任何目录创建、CLI 调用或输出写入前完成预检，再把已规划路径传给逐样本验证函数。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、现有 Phase 0 开发脚本

---

### Task 1: 用失败测试锁定输出规划契约

**Files:**
- Create: `tests/phase0-run-plan.test.ts`
- Create: `scripts/phase0-run-plan.ts`

- [x] **Step 1: 写正常规划与碰撞测试**

测试通过期望 API 导入：

```ts
import { createPhase0RunPlan } from "../scripts/phase0-run-plan.js";
```

断言正常输入保持顺序和当前命名：

```ts
expect(createPhase0RunPlan([
  join(inputDir, "alpha.jsonl"),
  join(inputDir, "beta sample.jsonl")
], outputDir)).toEqual([
  {
    inputFile: join(inputDir, "alpha.jsonl"),
    sampleId: "alpha",
    reportFile: join(outputDir, "alpha.report.json"),
    compressedFile: join(outputDir, "alpha.trimmed.jsonl")
  },
  {
    inputFile: join(inputDir, "beta sample.jsonl"),
    sampleId: "beta_sample",
    reportFile: join(outputDir, "beta_sample.report.json"),
    compressedFile: join(outputDir, "beta_sample.trimmed.jsonl")
  }
]);
```

分别断言 `a b.jsonl`/`a_b.jsonl` 和两个仅在第 120 字符后不同的输入抛出碰撞错误。错误必须包含基名和冲突 ID，但不含测试中的私有父路径。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-run-plan.test.ts`

Expected: 因 `scripts/phase0-run-plan.ts` 不存在而失败。

- [x] **Step 3: 实现最小纯规划器**

创建模块并导出：

```ts
export interface Phase0SamplePlan {
  inputFile: string;
  sampleId: string;
  reportFile: string;
  compressedFile: string;
}

export function createPhase0RunPlan(files: string[], outputDir: string): Phase0SamplePlan[];
```

用现有正则与 120 字符限制计算 `sampleId`。在返回计划前用 `Map<string, string>` 检测重复 ID；错误只使用 `basename`。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/phase0-run-plan.test.ts`

Expected: 规划顺序、输出名、两种碰撞和隐私断言全部通过。

### Task 2: 用进程测试锁定写前失败

**Files:**
- Create: `tests/phase0-run-safety.test.ts`

- [x] **Step 1: 写规范化碰撞的进程回归**

在 `mkdtemp` 输入目录复制一个有效 fixture 为 `a b.jsonl` 和 `a_b.jsonl`，运行：

```ts
node --import tsx scripts/phase0-run.ts --dir <input> --out <missing-output>
```

断言退出码非零、stderr 包含碰撞基名和 ID、不含临时父路径，并断言输出目录仍不存在。

- [x] **Step 2: 写同目录和目录别名的进程回归**

在输入目录放置一个有效 JSONL，记录 SHA-256，然后分别用同一路径及可创建时的目录 junction/symlink 作为 `--out`。断言退出码非零、stderr 仅包含固定参数错误、输入哈希不变，且没有 `*.report.json`、`*.trimmed.jsonl`、`phase0-results.json` 或 `validation-summary.md`。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-run-safety.test.ts`

Expected: 当前脚本碰撞用例成功退出并创建输出，同目录用例开始处理输入，至少一项安全断言失败。

### Task 3: 接入目录隔离与已规划路径

**Files:**
- Modify: `scripts/phase0-run-plan.ts`
- Modify: `scripts/phase0-run.ts`

- [x] **Step 1: 实现真实目录隔离**

在规划模块导出：

```ts
export async function assertDistinctPhase0Directories(
  inputDir: string,
  outputDir: string
): Promise<void>;
```

对输入目录调用 `realpath`；对存在的输出目录调用 `realpath`，不存在则保留 `resolve` 路径。Windows 比较使用小写规范化，其他平台直接比较。相等时抛出固定错误，不包含路径。

- [x] **Step 2: 重排主流程并复用计划**

把 `main` 改为：

```ts
await assertDistinctPhase0Directories(inputDir, outputDir);
const files = await listJsonlFiles(inputDir);
const plan = createPhase0RunPlan(files, outputDir);
await mkdir(outputDir, { recursive: true });

for (const sample of plan) {
  results.push(await validateSample(sample, options.timeoutMs));
}
```

`validateSample` 接收 `Phase0SamplePlan` 并使用其中的 `inputFile`、`reportFile`、`compressedFile`，删除脚本内重复的 `sanitizeName`。

- [x] **Step 3: 运行安全测试确认 GREEN**

Run: `npx vitest run tests/phase0-run-plan.test.ts tests/phase0-run-safety.test.ts`

Expected: 所有规划和写前失败断言通过。

- [x] **Step 4: 运行正常批次回归**

Run: `npx vitest run --testTimeout=30000 tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

Expected: 正常 Phase 0 工件命名、结果摘要和 review evidence 全部通过。

### Task 4: 同步开发文档

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录写前规划约束**

说明 input/output 必须是不同真实目录；输入基名在规范化后必须唯一；所有检查在输出目录创建和 CLI 执行前完成。

- [x] **Step 2: 记录已修复风险和不变契约**

状态文档与 CHANGELOG 记录原覆盖风险、当前 fail-fast 行为，以及 parser/scorer/threshold/compression 和公开命令不变。

- [x] **Step 3: 检查文档一致性**

Run: `rg -n "output name|same directory|different directories|collision|碰撞|同一.*目录" docs/dev/phase0 docs/dev/status-and-next-steps.md CHANGELOG.md`

Expected: Phase 0 执行和标签指南都能在批次开始前提示两个约束，状态说明与实现一致。

### Task 5: 完整质量门

**Files:**
- Verify only

- [x] **Step 1: Phase 0 聚焦测试与脚本类型检查**

Run: `npx vitest run --testTimeout=30000 tests/phase0-run-plan.test.ts tests/phase0-run-safety.test.ts tests/phase0-summary.test.ts tests/phase0-evidence.test.ts tests/phase0-review.test.ts`

Expected: 0 failures。

Run: `npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck scripts/phase0-run.ts scripts/phase0-run-plan.ts scripts/phase0-review.ts scripts/phase0-evidence.ts`

Expected: exit 0。

- [x] **Step 2: 全量测试与 build**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 发布与卫生检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: packed-install/fresh-install smoke 通过，Phase 0 开发脚本不进入发布包。

Run: `npm pack --dry-run --json --silent`

Expected: 发布文件集合保持既有 22 项。

Run: `git diff --check`

Expected: 无 whitespace errors；不产生 `.tgz`、`reports/phase0`、`datasets/private` 或真实样本输出。
