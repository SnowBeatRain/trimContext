# Phase 0 label 必填字段质量门设计

## 背景与根因

`docs/dev/phase0/manual-label-guide.md` 将 `sample_id`、`message_id`、`decision`、`label` 和 `review_note` 定义为必填字段。现有 `normalizeLabel()` 只硬校验 sample、message 和 label：非法或缺失 decision 被 `optionalDecision()` 静默转换为 `undefined`，`review_note` 完全未校验。`validateLabels()` 又只在 label/report decision 都有效时检查 mismatch，因此缺失或非法 decision 可以绕过陈旧标签检测；空 note 也能参与完整审查指标。其他 gate 全部通过时，这类 label artifact 可以错误得到 `locked`。

## 目标

- 将缺失或非法 label decision 计入隐私安全质量指标。
- 将非字符串或 trim 后为空的 review note 计入质量指标。
- 任一 required-field 问题阻止 `locked`，状态为 `review_required`。
- JSON/Markdown 只输出固定分类与数字，不输出非法值、review note、message ID 或 label 文件路径。
- 保持现有 sample/message/label 硬校验、引用检查、重复检查和 decision mismatch 语义。

## 非目标

- 不把 label loader 扩展为完整 JSON Schema validator。
- 不改变 label taxonomy、人工指标公式、batch/report quality gate 或状态优先级。
- 不校验可选 source、source_line 或 rot_score。
- 不修改 scorer、threshold、safety、compression 或公开 CLI。

## 数据模型

`NormalizedLabel` 保留可选 normalized decision，并新增不含原值的 note 质量事实：

```ts
interface NormalizedLabel {
  sample_id: string;
  message_id: string;
  decision?: Decision;
  label: ReviewLabel;
  has_review_note: boolean;
}
```

`metrics` 新增：

```ts
invalid_label_decisions: number;
missing_review_notes: number;
```

`invalid_label_decisions` 对 decision 缺失、类型错误或不属于四种现有 decision 的每条 label 计 1。`missing_review_notes` 对 note 缺失、非 string 或 trim 后为空的每条 label 计 1。`label_quality_issues` 改为 existing unknown references、duplicate labels、decision mismatches 与这两个计数之和。

## 数据流与状态

1. `normalizeLabel()` 继续拒绝无有效 sample ID、message ID 或 review label 的记录。
2. decision 使用现有 `optionalDecision()` 归一化；note 只保存布尔有效性，不保留正文。
3. `validateLabels()` 在既有引用/mismatch 检查外聚合 required-field 计数。
4. `evaluateGates()` 已检查 `label_quality_issues > 0`，无需新增状态分支；batch not-ready 仍优先 `review_required`，batch execution failed 仍优先 `failed`。
5. Markdown `Label Quality` 表增加两个固定数字行。

## 测试策略

- 使用完整五样本 batch、一个合法 remove report message 与一个合法 critical protected message。
- remove label 使用私有哨兵非法 decision 且有效 note；protected label 使用合法 decision 但空白 note。
- 确认旧实现 RED 为 `locked`，新实现为 `review_required`、`label_quality_issues: 2`、两个新增计数各 1。
- 确认 JSON/Markdown 不包含非法 decision 哨兵或 note 正文。
- 保留现有 locked、decision mismatch、report quality、batch evidence 与双工件事务回归。

## 成功标准

- 缺失/非法 decision 或无有效 review note 的 label 不再能参与 `locked` 信任声明。
- 合法 label artifact 的现有指标、阈值和状态不变。
- review 输出继续保持隐私收敛。
- 完整测试、构建、packed-install、22-file package 清单和 `git diff --check` 通过。
