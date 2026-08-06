# Phase 0 Report 来源绑定设计

## 背景与根因

`phase0:review` 已用 report ID 和精确字节 SHA-256 将 `phase0-results.json` 的成功 report 与实际 `*.report.json` 绑定，但来源覆盖仍完全从 `results[].source` 计数。`loadReports()` 只从实际 report 提取 `messages` 和 digest，没有读取 `input.source`。

因此，results v2 可以声明满足 2 Claude、1 OpenAI、2 Codex 覆盖，而五份 hash 完全匹配的实际 report 都来自同一来源。只要执行率、report 质量和人工标签通过，现有 review 仍可能得到 `locked`。Report hash 证明 review 使用了 batch 指定的字节，却没有约束 results 中单独保存的 source 声明与这些字节一致。

## 目标

- review 从实际解析的每份 report 读取 `input.source`，并与同一 report ID 的 results v2 `source` 精确匹配。
- 来源覆盖只统计 results 中标记 report 成功、实际 report 存在且其来源为支持枚举的配对 report。
- source 不匹配产生固定 `report_source_mismatch`，阻止 trust 锁定。
- review JSON/Markdown 公开 `matched_report_sources` 聚合数，不输出 report ID、路径或非法 source 值。
- results schema 继续使用 `trimctx.phase0.results.v2`，合法 evidence 无需迁移。
- 不改变 analyze/report/compress、scorer、threshold、protected、candidate decision、compression 或六命令公开面。

## 方案比较

### 继续信任 results v2 的 source

这保留了当前缺口。report digest 不覆盖 evidence 文件中独立保存的 source 字段，无法证明来源覆盖对应实际审查报告，因此不采用。

### 只从实际 report 重算来源计数

这能让覆盖数字反映实际 report，却无法显式发现 results 与 report 的来源声明分歧，也弱化了 batch evidence 与 review artifact 的逐样本关联，因此不采用。

### 按 report ID 对账 source，并从实际 report 计数

采用此方案。`loadReports()` 已从同一 Buffer 解析 report 并计算 hash，只需从解析对象读取 `input.source`。evidence 层按成功 report ID 对账期望与实际 source，同时用实际支持来源生成覆盖计数。这与现有 ID/hash 数据流一致，能形成“batch 样本 -> report input/source -> report bytes -> review bytes”的可审计链。

## 数据结构

`phase0-evidence.ts` 导出 report artifact 最小形状：

```ts
export interface Phase0ReportArtifact {
  sha256: string;
  source?: unknown;
}
```

`loadPhase0ValidationEvidence()` 接收：

```ts
ReadonlyMap<string, Phase0ReportArtifact>
```

`ValidationEvidence` 增加：

```ts
matched_report_sources: number;
```

results v2 本身不新增字段。review v2 是开发期聚合工件，增加该隐私安全计数而不更改状态枚举。

## 匹配与覆盖规则

对每个 `report.ok === true` 的规范化 result：

1. 从 `report_file` basename 得到期望 report ID。
2. report ID 集合继续与实际 artifact ID 集合完全匹配。
3. expected digest 继续与实际 artifact digest 比较。
4. expected `result.source` 必须与实际 artifact 的受支持 `input.source` 相等。
5. `matched_report_sources` 统计 ID 存在且 source 相同的 report 数。

`source_counts` 改为统计期望成功 report ID 对应的实际受支持 source。失败 report、缺失 report、额外 stale report 或非法 source 不增加覆盖。这样最小来源门代表实际进入人工审查的成功 report，而不是只有 analyze metadata 或手工 evidence 声明的样本。

issue 顺序保持稳定：现有结构、aggregate、report set 和 hash 问题之后追加 `report_source_mismatch`，再计算样本/来源覆盖不足。hash 与 source 是独立证据；同一 artifact 可以同时暴露内容漂移和来源分歧，但输出仍只有固定 code 与聚合数字。

## Review 数据流

`loadReports()` 对每份 report 仍只读取一次 Buffer：

1. 从 Buffer 解码并 JSON.parse。
2. 校验顶层对象和 `messages` array。
3. 保存 messages。
4. 从同一对象提取 `input.source`，不回显非法值。
5. 从同一 Buffer 计算 SHA-256。

实际 source 缺失或非法不让读取阶段泄露内容；evidence 层将其视为 source mismatch，并通过现有 readiness gate 保持 `review_required`。

## 非目标

- 不从文件扩展名、路径或消息形状猜测 parser source。
- 不比较 analyze 与 report source；`phase0:run` 继续优先使用合法 report metadata。
- 不对 source 字段做大小写或别名宽松处理。
- 不把 SHA-256 描述为数字签名或对抗同时重写 evidence/report 的攻击者。
- 不改变 report message/label 质量门和人工指标阈值。

## 测试策略

- evidence 单元测试：results 声明完整覆盖、hash 全匹配，但一个实际 artifact source 不同；断言 `matched_report_sources` 降低、`report_source_mismatch` 和对应覆盖不足出现，输出不含非法值。
- review 集成测试：results 声明 2/1/2，五份实际 report 全为 Claude；旧实现错误 `locked`，新实现必须 `review_required`，source 匹配为 2/5，OpenAI/Codex 覆盖不足。
- 更新所有合法 fixtures，使真实 report 带 `input.source`；已有 hash mismatch、label 和 report-quality 行为保持。
- 运行 Phase 0 聚焦、全量、build、packed/fresh-install、22-file pack 和六 sanitized fixture 端到端验证。

## 成功标准

- 来源覆盖不能再由与实际 report 字节不一致的 results 声明满足。
- 合法 results v2 与 report 集合继续得到原有 trust 结论，只新增来源匹配审计计数。
- review 输出不泄露 source 原值、路径、message ID 或正文。
- Phase 0 仍未锁定，不扩大自动压缩安全承诺。
