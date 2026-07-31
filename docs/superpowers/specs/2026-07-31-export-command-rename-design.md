# `export` 命令重命名设计

## 背景

完整规范化会话 Markdown 导出功能已经实现，但公开命令名 `transcript` 偏长。该功能尚未提交、发布或归档，因此可以在发布前直接更名，不需要保留兼容别名。

## 决策

公开命令改为：

```text
trimctx export [file] -o <conversation.md>
```

- `export` 是第六个公开子命令。
- 旧 `transcript` 子命令直接移除，调用时返回 unknown command。
- Claude Code 插件入口改为 `/trimctx:export`。
- Codex skill 仅记录 `trimctx export <file.jsonl> -o conversation.md`。
- 省略 `[file]`、可信当前窗口绑定、`.md` 限制、未脱敏警告、原子写入和只读输入契约保持不变。

## 内部边界

本次只修改入口名称，不修改产物语义：

- `trimctx.transcript.v1` 格式版本保持不变。
- `# trimctx Conversation Transcript` 标题保持不变。
- `src/core/transcript-markdown.ts` 及 formatter 类型名保持不变。
- 普通名词 `transcript` 在描述源 JSONL 或 Markdown 产物时继续使用。
- CLI 实现文件改为 `src/commands/export.ts`，注册函数改为 `registerExportCommand`，成功摘要使用 `export:`。
- 根 CLI 的旧命令拦截集合加入 `transcript`，避免默认 action 把 `transcript --help` 当作根命令帮助。

## 影响范围

- CLI 注册、命令实现和 CLI 测试。
- Claude 插件命令资产及 package contents smoke。
- Codex skill、README、双语 usage、开发主线文档和 `CHANGELOG.md`。
- 未归档 OpenSpec change 的 proposal、design、specs 和 tasks。
- 现有 superpowers 设计与执行计划中的公开命令引用。

不修改 parser、formatter、scorer、threshold、Report v2、new-chat 或 compressor。

## 测试策略

1. 先把公开命令面、CLI 导出、客户端资产和 packed-install 测试改为 `export`，并增加旧 `transcript` 为 unknown command 的断言。
2. 运行聚焦测试，确认因 `export` 尚未注册、资产尚未更名而失败。
3. 最小化重命名命令实现、注册和资产，使聚焦测试通过。
4. 同步文档与 OpenSpec 后，运行全量测试、两套构建、npm pack 清单、真实样本、`git diff --check` 和 OpenSpec strict validation。

## 发布约束

- 不保留双入口或隐藏别名。
- 不修改 package version。
- 不创建 commit、推送或归档 change，除非用户另行明确授权。
- 不修改原始或真实 JSONL。
