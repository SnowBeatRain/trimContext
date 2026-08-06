# Phase 0 Run 输出规划设计

## 背景与根因

`scripts/phase0-run.ts` 当前在处理每个样本时才把输入文件名规范化，并立即写入：

```ts
const safeName = sanitizeName(basename(file, ".jsonl"));
const reportFile = join(outputDir, `${safeName}.report.json`);
const compressedFile = join(outputDir, `${safeName}.trimmed.jsonl`);
```

不同输入名可能得到相同的 `safeName`。真实复现中，`a b.jsonl` 与 `a_b.jsonl` 均映射为 `a_b`；脚本以退出码 0 完成，但 2 个输入只留下 1 份 report 和 1 份 trimmed 副本。后处理样本覆盖了前一个样本的证据。

同一脚本还会在枚举输入前创建输出目录，且不拒绝 `--dir` 与 `--out` 指向同一真实目录。此时旧的 `*.trimmed.jsonl` 可能成为下一次批次输入，污染验证集合。

根因是批次没有“先规划、后写入”的边界：输出唯一性和目录隔离直到副作用已经开始后仍未得到证明。

## 目标

- 在任何 `mkdir`、CLI 子进程或输出写入前完成整个批次的输出规划。
- 规范化或 120 字符截断导致的任意重名必须失败，不得自动覆盖或静默改名。
- `--dir` 与 `--out` 指向同一目录或文件系统别名时必须失败。
- 错误只显示参数名、冲突输入基名和规范化 ID，不显示完整私有路径。
- 正常批次的文件顺序、输出名、结果 schema 和 Phase 0 review ID 保持不变。
- 不改变 parser、scorer、threshold、compression 或公开六命令面。

## 非目标

- 不为冲突文件自动追加哈希或序号。
- 不改变 `reports/phase0/<sample>.report.json` 和 `<sample>.trimmed.jsonl` 布局。
- 不阻止用户显式复用一个独立输出目录；正常重跑仍可覆盖同名旧工件。
- 不把 Phase 0 开发脚本加入 npm 发布包。

## 方案比较

### 方案 A：批次级写前规划并失败（采用）

把名称规范化和输出路径计算抽为纯函数。函数保留输入顺序，先为所有样本创建计划，再检查规范化 ID 唯一性。目录真实路径校验作为独立异步边界，在规划和副作用前执行。该方案不改变成功路径的工件契约，并把命名问题转为明确、可审计的操作失败。

### 方案 B：碰撞时追加短哈希

可以让批次继续执行，但会改变 report ID 和人工标签引用，并使相同输入集在命名算法变更后出现迁移问题。它还会把应由操作者明确解决的样本命名冲突隐藏起来，因此不采用。

### 方案 C：每个样本使用独立子目录

可以隔离所有文件名，但会改变 `phase0:review` 的 `*.report.json` 扫描方式、文档化路径和现有证据集合契约，超出本轮安全修复范围，因此不采用。

## 架构

新增 `scripts/phase0-run-plan.ts`，只负责无副作用的批次规划和目录隔离校验：

```ts
export interface Phase0SamplePlan {
  inputFile: string;
  sampleId: string;
  reportFile: string;
  compressedFile: string;
}

export function createPhase0RunPlan(
  files: string[],
  outputDir: string
): Phase0SamplePlan[];

export async function assertDistinctPhase0Directories(
  inputDir: string,
  outputDir: string
): Promise<void>;
```

`createPhase0RunPlan` 按传入顺序计算现有规范化名称。若同一输出身份出现两次，抛出固定结构的简洁错误，错误中只包含两个输入的 basename 和冲突 ID；Windows 输出身份忽略大小写，避免大小写敏感输入目录向默认大小写不敏感输出目录迁移时发生覆盖。

`assertDistinctPhase0Directories` 对两个已经存在的目录使用 `realpath`，从而识别相对路径、大小写和 junction/symlink 别名。输出目录不存在时，它不创建目录；此时该路径不可能已经与现有输入目录代表同一目录。比较在 Windows 上忽略大小写，在其他平台保持文件系统常规路径大小写语义。

`scripts/phase0-run.ts` 的主流程改为：

```text
解析参数并 resolve
  -> 校验 input/output 真实目录不同
  -> 枚举并排序输入
  -> 为全部输入创建输出计划并检查碰撞
  -> 创建输出目录
  -> 按计划依次执行 analyze/report/compress
  -> 写聚合结果和摘要
```

`validateSample` 接收单个 `Phase0SamplePlan`，不再自行推导输出名，避免校验与实际写入使用两套逻辑。

## 错误与隐私

同目录错误使用固定文本：

```text
--dir and --out must refer to different directories
```

碰撞错误只显示基名和规范化 ID，例如：

```text
Phase 0 output name collision: "a b.jsonl" and "a_b.jsonl" both map to "a_b"
```

两类错误都必须在输出目录创建和 CLI 调用前发生。错误不得包含 `inputDir`、`outputDir` 或任一输入的完整路径。

## 测试策略

- 纯规划测试验证正常多样本保持输入顺序和现有输出名。
- 纯规划测试验证空白替换、长度截断和 Windows 大小写等价造成的碰撞都会失败，且错误不含完整路径。
- 进程集成测试验证碰撞失败后输出目录仍不存在。
- 进程集成测试验证 input/output 同目录及其目录别名均失败，输入 SHA-256 不变，且目录内没有 Phase 0 输出工件。
- 现有 `phase0-summary` 正常批次测试继续证明成功路径未变。
- 最后运行 Phase 0 聚焦测试、全量测试、build、脚本严格类型检查、package smoke、dry-run 打包和工作区卫生检查。

## 成功标准

- 任意两个输入不可能写入同一 report 或 trimmed 路径。
- 同一真实目录不可能同时作为 Phase 0 输入与输出。
- 所有失败都发生在首个文件系统写入或 CLI 子进程之前。
- 正常批次仍生成与改动前相同命名和 schema 的工件。
- 输入 JSONL 始终保持只读。
