## MODIFIED Requirements

### Requirement: 自动会话发现入口唯一化

系统 SHALL 仅暴露一个自动发现本地最近会话并执行分析的 CLI 主命令：`trimctx current`。

#### Scenario: 用户查看 CLI 总帮助

- **WHEN** 用户运行 `trimctx --help`
- **THEN** 帮助输出包含 `current [options]`
- **AND** 帮助输出不再包含 `resume [options]`

#### Scenario: 用户分析最近 Claude Code 会话

- **WHEN** 用户运行 `trimctx current --source claude --json`
- **THEN** 系统分析 `~/.claude/projects/` 下最近修改的会话文件
- **AND** 输出完整 JSON 报告

#### Scenario: 用户分析最近自动发现会话

- **WHEN** 用户运行 `trimctx current --json`
- **THEN** 系统在受支持来源中选择最近修改的会话文件
- **AND** 输出完整 JSON 报告

### Requirement: 删除误导性的 resume 命令

系统 SHALL 移除 `trimctx resume` 命令，避免将其表述为“恢复当前会话窗口”能力。

#### Scenario: 用户查看文档中的自动发现命令

- **WHEN** 用户阅读 README 或使用文档中的自动发现章节
- **THEN** 文档只将 `trimctx current` 描述为自动发现入口
- **AND** 文档不再把 `trimctx resume` 作为可用命令说明

#### Scenario: 打包产物包含客户端命令资产

- **WHEN** 项目生成 npm 打包清单
- **THEN** 清单包含 `plugins/trimctx/commands/trimctx.md`、`analyze.md`、`compress.md`
- **AND** 清单不包含 `plugins/trimctx/commands/trimctx/resume.md`
