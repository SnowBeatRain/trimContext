# Candidate reason 完整性设计

## 背景与根因

报告把 `remove_candidate` 和 `compress_candidate` 作为需要人工审查的建议。正常 scorer 只有在检测到信号时才会产生这两种 decision，并同步写入 `reasons`，但当前不变量只覆盖 `remove_candidate`：

- `createReviewQueue()` 会拒绝没有 reason 的 `remove_candidate`，却允许没有 reason 的 `compress_candidate` 进入审查队列。
- `phase0-review.ts` 校验报告消息的 ID、decision、protected 和 rot score，却不校验候选理由。
- 因此手工构造、外部来源或损坏的报告可能包含无法解释的候选；只要其他证据和人工标签完整，仍可能通过正式 trust gate。

这不是 scorer 或 threshold 的误判问题，而是报告生成边界和持久化证据边界对同一可审计性契约执行不完整。

## 目标

- 每条 `remove_candidate` 和 `compress_candidate` 都必须至少有一个 reason。
- 报告构造时立即拒绝违反契约的候选，不生成部分可信的 review queue。
- Phase 0 在归档前独立校验持久化报告，不信任报告一定由当前 producer 生成。
- Phase 0 只输出固定聚合计数，不输出 reason 原值、message ID、路径或正文。
- 合法报告的评分、decision、压缩结果、人工审查指标和锁定阈值保持不变。

## 非目标

- 不修改 scorer、threshold、signal detection、protected 规则或 compression。
- 不把 `compress_candidate` 纳入自动删除；它继续只供报告审查。
- 不把 Phase 0 脚本扩展为完整 Report v2 JSON Schema validator。
- 不校验 reason 枚举值或回显损坏值；本轮只验证候选是否具有非空数组。
- 不要求 `keep` 或 `keep_protected` 的 reasons 非空。

## 方案比较

### 仅校验报告 producer

可以阻止当前 CLI 生成无理由候选，但不能保护 Phase 0 读取的旧报告、手工修改报告或其他 producer 输出。持久化证据仍可能绕过契约。

### 仅校验 Phase 0 gate

可以阻止错误锁定 trust，但 CLI 仍可能先生成无法解释的 review queue，把问题推迟到归档阶段。

### 双层校验

采用此方案。两层没有重复业务决策：

- `createReviewQueue()` 维护进程内报告构造不变量。
- `validateReports()` 维护跨进程、持久化 artifact 的最小证据契约。

## 校验语义

候选由合法 decision `remove_candidate` 或 `compress_candidate` 确定。

- 核心层接收类型化 `Reason[]`，数组长度必须大于零；错误继续包含 decision 和 message ID，供本地开发定位。
- Phase 0 面向 `unknown` JSON。只有 `Array.isArray(message.reasons) && message.reasons.length > 0` 才视为完整。
- decision 非法时由 `invalid_message_decisions` 计数，不推断其是否为候选。
- 同一候选可以同时产生其他 report-quality issue；每类问题独立计数。

## Phase 0 输出与状态

`metrics` 新增：

```ts
missing_candidate_reasons: number;
```

该字段按违反契约的候选消息 occurrence 计数，并计入 `report_quality_issues`。Markdown 的 `Report Quality` 表只增加固定行和数字。

当 batch validation 已通过但该计数大于零时，trust 状态为 `review_required`，而不是 `failed`。artifact 无法可靠解释不等同于 scorer 已被证明违反人工安全阈值。

## 测试策略

- 核心层构造一个有 decisive evidence、但 reasons 为空的 `compress_candidate`，确认旧实现会生成报告，新实现明确拒绝。
- Phase 0 构造原本可锁定的完整 evidence：合法 remove candidate、空 reasons 的 compress candidate 和 critical protected message；确认缺失理由被聚合且阻止 `locked`。
- 更新既有合法 Phase 0 fixtures，为候选补充 reason；损坏 fixture 只在专用失败用例中省略。
- 确认 JSON/Markdown 不包含私有 reason sentinel 或 message ID。
- 用四份真实报告确认所有候选已有 reasons，修改前后报告和输入 SHA-256 不变。

## 成功标准

- 任一无理由的 remove/compress candidate 都不能生成合法 review queue，也不能通过 Phase 0 trust gate。
- `missing_candidate_reasons` 准确计入 report quality，并以隐私收敛的形式输出。
- 合法报告与真实 transcript 的既有输出、评分和压缩决策不变。
