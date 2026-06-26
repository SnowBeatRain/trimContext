## MODIFIED Requirements

### Requirement: handoff 当前能力边界清晰

系统 SHALL 将 `trimctx handoff <file>` 描述为“生成 UID 交接包”的命令，而不是“通过 UID 恢复会话”的命令。

#### Scenario: 用户阅读 handoff 使用说明

- **WHEN** 用户查看 README 或使用文档中的 `handoff` 章节
- **THEN** 文档说明命令会生成 `.trimctx/handoffs/<uid>/` 交接包
- **AND** 文档说明输出的 `uid` 便于引用和复制
- **AND** 文档明确当前不存在 `resume <uid>` 或等效恢复命令
