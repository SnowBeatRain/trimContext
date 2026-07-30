## MODIFIED Requirements

### Requirement: Claude Code 插件命令与 CLI 主入口一致

系统 SHALL 让内置 Claude Code 插件命令与 CLI 主入口保持一致，不暴露已删除的 `resume` 命令资产。

#### Scenario: 用户查看插件命令列表

- **WHEN** 用户检查插件命令文档或打包后的插件目录
- **THEN** 插件包含 `/trimctx`、`/trimctx:analyze`、`/trimctx:compress`
- **AND** 插件不再包含 `/trimctx:resume`

### Requirement: hooks 可由交互式 init 引导安装

系统 SHALL 支持在交互式 `trimctx init` 中引导用户安装 Claude 当前窗口 hooks，并在非交互安装中保持显式开启。

#### Scenario: 用户阅读 init 和 hooks 文档

- **WHEN** 用户查看 `trimctx init`、`trimctx hook`、`trimctx install-hooks` 相关说明
- **THEN** 文档明确 `hook` 是被 Claude Code Stop hook 调用的执行命令
- **AND** 文档明确 `trimctx hook --session-start` 是内部 SessionStart hook 执行路径，不是顶层公开命令
- **AND** 文档明确 `install-hooks` 可在资产已安装后单独安装或修复 hooks
- **AND** 文档明确交互式 `init` 会询问是否启用 hooks，默认推荐启用
- **AND** 文档明确非交互 `init` 只有传入 `--with-hooks` 才会安装 hooks
