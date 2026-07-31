## ADDED Requirements

### Requirement: Claude Code 提供当前窗口 export 命令

系统 SHALL 在已打包 Claude Code 插件中提供 `/trimctx:export`，该命令只读取 `TRIMCTX_TRANSCRIPT_PATH` 并将完整规范化 transcript 写到独立 Markdown 文件。

#### Scenario: Claude 当前窗口导出

- **WHEN** 用户在已正确绑定的 Claude Code 窗口运行 `/trimctx:export`
- **THEN** 插件调用 `trimctx export "$TRIMCTX_TRANSCRIPT_PATH" -o conversation.md`
- **AND** 插件说明原始 transcript 未修改、输出未脱敏且分享前必须审查

#### Scenario: Claude 当前窗口缺少绑定

- **WHEN** `TRIMCTX_TRANSCRIPT_PATH` 缺失
- **THEN** 插件停止并提示运行 `trimctx init --with-hooks` 后重启 Claude Code
- **AND** 不回退到 latest session

### Requirement: Codex skill 说明 export 的准确边界

系统 SHALL 在打包的 Codex skill 中记录显式文件 `export` 命令、多窗口路径确认要求、完整内容隐私警告和原始 JSONL 只读边界。

#### Scenario: Codex 用户读取常用命令

- **WHEN** 用户或 Codex agent 读取已安装 trimctx skill
- **THEN** 文档包含 `trimctx export <file.jsonl> -o conversation.md`
- **AND** 多窗口说明要求确认并显式传入 JSONL 路径
- **AND** 文档不宣称存在经过验证的 Codex 当前窗口绑定

### Requirement: npm 包验证已安装 export 工作流

系统 SHALL 在 packed-install smoke 中验证安装后的 CLI 帮助包含 `export`，并使用 sanitized fixture 实际生成可读取的 Markdown transcript。

#### Scenario: fresh install tarball

- **WHEN** 测试从本地 tarball 全局安装 trimctx 到临时 prefix
- **THEN** 安装后的 `trimctx --help` 包含 `export [options] [file]`
- **AND** 安装后的命令能从 sanitized fixture 生成含完整规范化消息的 Markdown
- **AND** fixture hash 在执行前后相同
