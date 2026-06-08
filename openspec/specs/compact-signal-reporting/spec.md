# compact-signal-reporting Specification

## Purpose
TBD - created by archiving change add-compact-signal-reporting. Update Purpose after archive.
## Requirements
### Requirement: Away Summary Warning

系统 SHALL 在分析报告中提示 Claude Code 会话包含 `away_summary` compact 信号。

#### Scenario: Report warns when away_summary exists

- **WHEN** 输入消息中存在 raw record `type` 为 `system` 且 `subtype` 为 `away_summary`
- **THEN** report 的 `warnings` 包含明确说明 compact/away_summary 已出现的提示
- **AND** 该消息仍按现有规则参与分析
- **AND** 系统不因此修改压缩删除策略

