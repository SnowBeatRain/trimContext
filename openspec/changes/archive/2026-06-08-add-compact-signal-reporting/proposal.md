## Why

`docs/work/integration-value-assessment.md` 将 `compact/away_summary` 信号列为必须集成项。Claude Code JSONL 中的 `system` `away_summary` 记录表示会话曾被 Claude 自动压缩过，这对用户理解分析结果和 Phase 0 多样本验证很重要。

当前 parser 会保留 system metadata，但 report 没有明确提示会话包含 compact/away_summary 信号。

## What Changes

- 当输入 Claude Code JSONL 包含 `type: "system"` 且 `subtype: "away_summary"` 的记录时，在 report warnings 中输出明确提示。
- 保持现有 message 分析和压缩行为不变。

## Core Features

- 检测 Claude Code `away_summary` metadata。
- 在 `AnalysisReport.warnings` 中加入可审计 warning。
- 不把该信号作为删除候选，不改变 scoring 阈值。

## Capabilities

### New Capabilities
- `compact-signal-reporting`：在分析报告中标记会话已出现 Claude compact/away_summary 信号。

### Modified Capabilities
- None

## Impact

- `src/core/reporter.ts`
- `tests/reporter.test.ts`

## Non-Goals

- 不修改 compressor 删除策略。
- 不引入新的 report schema version。
- 不实现完整 relations 或 entity extraction。

## Open Questions

- None
