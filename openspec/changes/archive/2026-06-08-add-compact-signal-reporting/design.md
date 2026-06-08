## Context

当前 `createReport(messages, file)` 会从已分析的 `NormalizedMessage[]` 生成 JSON report，`warnings` 目前固定为空数组。

Claude Code parser 会把原始 JSONL record 保存在 `NormalizedMessage.raw` 中，因此 reporter 可以不改 parser，直接检查 raw record：

```ts
raw.type === "system" && raw.subtype === "away_summary"
```

## Goals / Non-Goals

**Goals:**

- 在 report warnings 中暴露 compact/away_summary 信号。
- 不影响现有 scoring、decision 和 compressor 行为。

**Non-Goals:**

- 不新增 summary 字段。
- 不修改 parser flatten 行为。
- 不做完整 compact 历史分析。

## Decisions

### Decision 1: 在 reporter 中生成 warning

选择在 `createReport` 中检查 `messages`，因为 warnings 是 report 产物的一部分，且 `NormalizedMessage.raw` 已包含足够信息。

## Approach

- 新增内部 helper，例如 `collectWarnings(messages)`。
- 检测任意 message 的 `raw` 是否为 record，并匹配 `type === "system"`、`subtype === "away_summary"`。
- 返回固定 warning 文案。
- 保持 warnings 数组可扩展。

## Verification

- 先在 `tests/reporter.test.ts` 添加失败测试。
- 测试构造带 `raw: { type: "system", subtype: "away_summary" }` 的消息。
- 断言 report warnings 包含 `away_summary`。
