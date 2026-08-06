# Phase 0 Validation Evidence Gate 设计

## 背景与根因

`docs/dev/phase0/phase0-plan.md` 把 Phase 0 锁定定义为两类证据同时成立：

- 批次执行证据：至少 5 个真实样本，Claude/OpenAI/Codex 来源覆盖达标，analyze/report/compress 成功率至少 95%，输入修改数为 0。
- 人工审查证据：critical false deletion 为 0、protected recall 为 100%、remove-candidate precision 至少 70%，且标签覆盖和质量要求成立。

`scripts/phase0-run.ts` 已生成前一类证据到 `phase0-results.json`，但 `scripts/phase0-review.ts` 当前完全不读取该文件，只按报告和标签计算后一类证据。现有测试因此能用 1 份报告和单一来源得到 `trust_status: locked`。根因是最终 trust gate 没有把两个已有阶段连接起来，不是指标阈值本身错误。

## 目标

- `phase0:review` 只有在批次执行证据和人工审查证据均完整且通过时才能返回 `locked`。
- 保持现有命令行不变；默认读取 `--reports` 目录中的 `phase0-results.json`。
- 校验结果文件与实际 `*.report.json` 集合属于同一批次，防止陈旧、缺失、额外或文件名冲突的报告参与锁定。
- 输出不泄露 sample 路径、report 路径、stderr、错误详情、标签 note 或消息正文。
- 不改变 parser、scorer、threshold、compression 或公开 CLI。

## 非目标

- 不自动创建或填写人工标签。
- 不把私有 `phase0-results.json` 复制到公开目录。
- 不调整 Phase 0 现有数值门槛。
- 不把开发脚本并入 npm 发布包或新增公开命令。
- 不解决真实样本数量不足；只保证不足时不可能误报 `locked`。

## 方案比较

### 方案 A：自动读取同目录 `phase0-results.json`（采用）

`phase0:run` 和文档化的 `phase0:review` 命令本来就共享 `reports/phase0`。review 自动加载同目录证据，不增加用户步骤，并能把已有两个阶段闭环。缺失或不一致证据作为可审计的 `review_required` 输出，而不是给出锁定结论。

### 方案 B：新增必填 `--results <file>`

显式路径最灵活，但会破坏现有命令和所有调用方，并允许用户把 labels/reports 与另一个目录的 results 人为拼接。当前只有标准同目录工作流，没有足够收益支持新增参数，因此不采用。

### 方案 C：合并 `phase0:run` 和 `phase0:review`

单命令可天然共享状态，但人工标注发生在两个阶段之间，合并会引入暂停/恢复协议和更大迁移面，不符合本轮最小修复范围，因此不采用。

## 架构

### `scripts/phase0-evidence.ts`

新增只负责批次证据读取和判定的模块。输入是 reports 目录和当前已加载的 report sample ID 集合，输出为不含路径或消息内容的结构化摘要：

```ts
interface ValidationEvidence {
  available: boolean;
  ready: boolean;
  passed: boolean;
  sample_count: number;
  source_counts: Record<"claude-code-jsonl" | "openai-jsonl" | "codex-jsonl", number>;
  analyze_success_rate: number | null;
  report_success_rate: number | null;
  compress_success_rate: number | null;
  input_unchanged: number;
  expected_reports: number;
  matched_reports: number;
  issues: string[];
}
```

该模块读取 `phase0-results.json`，从 `results[]` 逐项重新计算成功数、输入不变数、来源数和预期 report ID，而不是只信任 aggregate。随后校验声明的 `sample_count`、aggregate 与重算值一致，并校验预期 report ID 集合与目录中实际加载集合完全一致。

### `scripts/phase0-review.ts`

保留标签规范化、人工指标和 Markdown 编排职责。加载 reports 后调用批次证据模块，把 `validation` 摘要写入 JSON/Markdown，并把它传给最终 gate：

```text
validation.ready == false
  -> review_required

validation.ready == true && 任一执行门失败
  -> failed

validation.passed == true && 人工审查未完成或标签质量有问题
  -> review_required

validation.passed == true && 人工数值门失败
  -> failed

validation.passed == true && 人工门全部通过
  -> locked
```

## 批次证据规则

### 结构一致性

- 文件必须存在且是合法 JSON 对象，schema 为 `trimctx.phase0.results.v1`。
- `results` 必须是数组，声明的 `sample_count` 必须等于数组长度。
- 每项必须包含布尔型 `analyze.ok`、`report.ok`、`compress.ok`、`input_unchanged`。
- 成功 report 必须提供字符串 `report.report_file`，其 basename 去掉 `.report.json` 后作为 sample ID。
- 同一批次不能产生重复预期 report ID；这同时检测 sanitize-name 输出碰撞。
- aggregate 四个计数必须与逐项重算值一致。
- 预期成功 report ID 集合必须与 reports 目录实际加载集合完全一致。

结构缺失、证据文件缺失、计数矛盾或报告集合不一致会加入固定 issue code，并使 `ready=false`。错误摘要不得包含文件内容或私有路径。

### 覆盖完整性

- 总样本至少 5。
- `claude-code-jsonl` 至少 2 个。
- `openai-jsonl` 至少 1 个。
- `codex-jsonl` 至少 2 个。

覆盖不足表示仍需补充证据，因此 `ready=false`、状态为 `review_required`，而不是质量失败。

### 执行质量

- analyze 成功率至少 0.95。
- report 成功率至少 0.95。
- compress 成功率至少 0.95。
- `input_unchanged` 必须等于样本数。

只有结构和覆盖已经 ready 后才判断执行质量。执行质量未达标表示现有完整批次已证明门槛失败，因此 trust status 为 `failed`。

## 输出与隐私

`phase0-review.json` 升级为 `trimctx.phase0.review.v2`，新增 `validation`，`gates` 新增批次门槛常量，并移除既有 reports/labels 绝对路径。`phase0-review.md` 新增 Validation Evidence 表，展示样本数、来源计数、三项成功率、输入不变数、report 匹配数、ready/passed 和固定 issue codes。

输出不包含：

- `input_dir` / `output_dir`；
- sample、report 或 label 文件路径；
- `stderr`、`error`、raw message、review note；
- 私有 JSON 原文。

## 测试策略

- 现有“单报告可 locked”用例先改为期望 `review_required`，形成根因 RED。
- 为既有人工指标测试生成 5 份、三来源、全成功、哈希不变且与报告集合匹配的最小 results 证据，继续分别覆盖 `locked`、`failed` 和标签质量 `review_required`。
- 新增缺失 results、样本/来源不足、aggregate 矛盾、report 集合不匹配测试，全部必须 `review_required`。
- 新增完整覆盖但成功率不足或输入被修改的测试，必须 `failed`。
- Markdown/JSON 断言 fixed issue code 和汇总值，同时断言不含测试中的敏感路径/错误文本。
- 完成后运行 Phase 0 聚焦测试、全量测试、build、package smoke 和差异检查。

## 成功标准

- 单一样本或单一来源不再可能得到 `locked`。
- 缺少 `phase0-results.json` 时仍生成可审计 review 输出，但状态为 `review_required`。
- 只有符合正式 Phase 0 计划的完整执行批次和人工门同时通过时返回 `locked`。
- 现有文档化命令无需新增参数。
- review 输出继续保持私有内容安全。
