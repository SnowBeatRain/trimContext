# Phase 0 report artifact 质量门设计

## 背景与根因

`phase0:review` 当前只验证 label 引用、重复 label 和 label/report decision mismatch。报告自身的 message 记录被直接用于覆盖率和精度计算：

- 缺失或空 `id` 的 message 被静默跳过，不进入待审总数。
- 重复 `id` 共用同一条 label，并在逐 message 循环中被重复计为已审。
- 非法或缺失 `decision` 被忽略。
- 非 boolean `protected` 和非有限 number `rot_score` 会改变 protected/critical 分类而不产生质量问题。
- `decision === keep_protected` 与 `protected` 不一致时仍按宽松 OR 逻辑参与指标。
- 非对象 message 可能触发运行时错误，无法生成隐私安全的审计结果。

因此损坏或手工修改的 report artifact 可能缩小审查分母，或让一条 label 覆盖多个物理消息，在 label quality 为零时错误得到 `locked`。

## 目标

- 在计算 trust status 前验证所有 report message 的最小 gate-relevant 结构。
- 对每类 report artifact 问题只输出聚合计数，不输出 sample/message ID 或正文。
- 任一 report quality issue 都必须阻止 `locked`，状态为 `review_required`。
- 保持 label quality、batch validation、人工安全阈值和既有成功指标语义。
- 不自动修正、去重或猜测损坏报告。

## 非目标

- 不把此脚本扩展为完整 `trimctx.report.v2` JSON Schema validator。
- 不修改 parser、report producer、scorer、threshold、safety 或 compression。
- 不改变合法报告的指标、锁定阈值或发布门。
- 不在输出中包含无效字段值、文件路径、message ID、label note 或正文。

## 质量字段

`metrics` 新增以下 additive 字段：

```ts
report_quality_issues: number;
invalid_message_records: number;
missing_message_ids: number;
duplicate_message_ids: number;
invalid_message_decisions: number;
invalid_protected_flags: number;
invalid_rot_scores: number;
inconsistent_protection_decisions: number;
```

计数规则：

- `invalid_message_records`：array item 不是非 null、非 array 对象。
- `missing_message_ids`：对象的 `id` 不是 trim 后非空 string。
- `duplicate_message_ids`：同一 sample 内每个首条之后的重复 occurrence 计 1；不同 sample 可使用相同 ID。
- `invalid_message_decisions`：`decision` 不是四种既有 decision 之一。
- `invalid_protected_flags`：`protected` 不是 boolean。
- `invalid_rot_scores`：`rot_score` 不是有限 number。
- `inconsistent_protection_decisions`：decision 和 protected 各自有效，但 `decision === "keep_protected"` 与 `protected === true` 不相等。
- `report_quality_issues`：上述计数之和。

## 数据流

1. `loadReports()` 继续只要求顶层 `messages` 是 array，不回显内容。
2. `summarize()` 首先调用 `validateReports()` 得到 report quality 聚合。
3. 指标循环跳过非对象与缺失 ID 记录，避免运行时错误；合法记录保持既有计数逻辑。
4. label 引用 map 对重复 ID 只保留首个物理记录；重复本身已由 report quality 阻止锁定。
5. `evaluateGates()` 在 batch validation 通过后检查 report/label quality；任一质量问题返回 `review_required`。
6. JSON metrics 和 Markdown `Report Quality` 表仅展示数字。

## 状态语义

- batch evidence 不完整仍优先为 `review_required`。
- batch execution gate 失败仍为 `failed`。
- batch 通过但 report 或 label quality 有问题时为 `review_required`。
- 只有 report quality 为零、label quality 为零、审查覆盖完整且安全阈值通过时才可 `locked`。

report artifact 质量问题说明证据不可可靠解释，不代表 scorer 已证明失败，因此不使用 `failed`。

## 测试策略

- 构造含两个相同 remove-candidate ID 的完整五样本 evidence，只提供一条 safe label 和完整 protected label；确认旧实现 RED 为 `locked`，新实现为 `review_required`、`duplicate_message_ids: 1`。
- 构造 null record、缺失 ID、非法 decision/protected/rot_score 和 protection mismatch，确认脚本不崩溃、所有聚合计数准确、状态不锁定。
- 确认 JSON/Markdown 不包含无效 ID、字段值、路径或正文。
- 保留既有 missing evidence、failed batch、label quality、successful locked 和 Markdown 回归。

## 成功标准

- 一条 label 不再能让重复 report IDs 对应的多个物理消息通过完整覆盖门。
- 被跳过或降级的 malformed message 必有对应 report quality 计数。
- 所有 report quality 问题都明确阻止 `locked`，且审计输出保持隐私收敛。
- 合法 artifact 的既有锁定结果和指标不变。
