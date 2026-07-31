## ADDED Requirements

### Requirement: 公开 export 命令

系统 SHALL 在保持 `init`、`analyze`、`report`、`new-chat` 和 `compress` 既有契约不变的前提下，将 `export` 作为第六个公开子命令，且不保留旧 `transcript` 命令别名。

#### Scenario: 用户查看 CLI 总帮助

- **WHEN** 用户运行 `trimctx --help`
- **THEN** 帮助输出包含 `export [options] [file]`
- **AND** 其余五个公开子命令仍存在
- **AND** 旧 `transcript`、内部 `hook` 与其他已移除命令不出现在帮助中

#### Scenario: 用户查看 export 帮助

- **WHEN** 用户运行 `trimctx export --help`
- **THEN** 帮助说明 `[file]` 可由当前窗口可信绑定提供
- **AND** `-o, --output <conversation.md>` 为必填选项
- **AND** 不暴露 scorer、threshold、session discovery 或压缩参数

#### Scenario: 用户尝试旧命令名称

- **WHEN** 用户运行 `trimctx transcript --help`
- **THEN** 命令以非零状态退出并报告未知命令
- **AND** 不将旧名称转发或别名到 `export`
