## ADDED Requirements

### Requirement: Preserve Meta Skill Injection As Protected Metadata

系统 SHALL 不把 `isMeta=true` 的 Claude Code skill 注入内容当作普通用户对话处理，而应保留为 system metadata 以便 safety rules 保护。

#### Scenario: Parse isMeta records as system metadata

- **WHEN** Claude Code JSONL 行包含 `isMeta: true`
- **THEN** parser 输出该行对应的 `NormalizedMessage`
- **AND** `role` 为 `system`
- **AND** `content` 包含 `[isMeta]` 标记
- **AND** 该内容不会被当作普通 user 消息

### Requirement: Tool Result Content Variants

系统 SHALL 支持 tool_result content 为 string 或 list 的格式。

#### Scenario: Parse string and list tool_result content

- **WHEN** tool_result block 的 `content` 是 string
- **THEN** parser 输出 tool message，并保留文本内容
- **AND** `tool.toolResultFor` 指向对应 tool_use id
- **WHEN** tool_result block 的 `content` 是 list
- **THEN** parser 合并其中的 text 内容

### Requirement: Assistant Streaming Frames

系统 SHALL 避免把同一 `message.id` 的 assistant 流式分片重复计入。

#### Scenario: Replace streaming start frame with final frame

- **WHEN** assistant record 含有相同 `message.id`
- **AND** 后续同 id record 带有 `usage`
- **THEN** parser 只输出一条该 `message.id` 对应的 `NormalizedMessage`
- **AND** 输出内容来自后续最终帧

### Requirement: Away Summary Metadata

系统 SHALL 保留 `away_summary` metadata 的 raw 信息，以便 report warnings 检测 compact 信号。

#### Scenario: Preserve away_summary raw metadata

- **WHEN** Claude Code JSONL 包含 `type: "system"` 且 `subtype: "away_summary"`
- **THEN** parser 输出或保留足够信息供 reporter 识别
- **AND** `raw.subtype` 仍为 `away_summary`
