# trimctx

trimctx 是一个本地优先的 TypeScript CLI，用来检查 AI 长对话 JSONL 文件，并生成保守、可审计的上下文精简建议。

当前版本支持 Claude Code 和 OpenAI 风格的 JSONL 对话。它会分析每条消息、标记受保护内容、解释为什么保留或建议移除某条消息、写出 JSON 报告，并能生成一个不改动原文件的压缩副本。

**安全原则：trimctx 宁可少删，也不要误删。** `compress` 永远不会原地修改输入 JSONL 文件。

[English](README.md)

## 当前状态

trimctx 目前是早期 CLI 工具。已经实现的命令是：

- `trimctx analyze <file>` — 输出短摘要，或通过 `--json` 输出完整 JSON
- `trimctx report <file> -o <report.json>` — 写出完整 JSON 报告
- `trimctx compress <file> -o <output.jsonl>` — 写出安全压缩副本
- `trimctx resume` — 分析 `~/.claude/projects/` 下最新的 Claude Code 会话

## 快速开始

### 从源码运行

需要 Node.js 20+。

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

分析一个对话文件：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

写出完整报告：

```bash
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
```

生成压缩副本：

```bash
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

构建后也可以直接运行编译产物：

```bash
node dist/cli.js analyze path/to/session.jsonl
```

### 全局 npm 安装

项目已准备 npm 风格的全局安装入口，但只有在版本发布到 npm 后才应使用：

```bash
npm install -g trimctx
trimctx analyze path/to/session.jsonl
```

## trimctx 做什么

- 自动识别 Claude Code JSONL 和 OpenAI JSONL 输入格式。
- 归一化消息、tool-use 块、tool result 和元事件，便于统一分析。
- 在本地估算 token 数，不调用 LLM，也不访问远程 API。
- 保护高风险内容，例如最近消息、system/developer 指令、用户决策、代码、错误、文件路径、命令、diff、schema/API/config 变更，以及被后续引用的工具结果。
- 基于消息年龄、重复度、后续引用度、孤立工具输出、被后续指令覆盖、低价值元信息等维度给内容打分。
- 输出人类可读摘要，也能输出包含决策和原因的完整 JSON 报告。
- 通过排除非 protected 的 `remove_candidate` 消息，写出新的压缩 JSONL 副本。

## 命令

### `trimctx analyze <file>`

分析 Claude Code 或 OpenAI JSONL 对话。

```bash
trimctx analyze session.jsonl
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

选项：

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `--json` | `false` | 输出完整 JSON 报告，而不是短摘要 |
| `--color` | `false` | 给终端摘要加颜色 |
| `--recent-window <count>` | `30` | 硬保护最近 N 条消息 |
| `--remove-threshold <score>` | `0.80` | 标记为 `remove_candidate` 的最低 `rot_score` |
| `--compress-threshold <score>` | `0.60` | 标记为 `compress_candidate` 的最低 `rot_score` |

### `trimctx report <file> -o <report.json>`

把完整 JSON 报告写入文件。

```bash
trimctx report session.jsonl -o report.json
```

报告包含输入元信息、摘要统计、每条消息的决策、token 估算、评分、原因、移除候选和警告。

### `trimctx compress <file> -o <output.jsonl>`

写出新的 JSONL 文件，只排除非 protected 的 `remove_candidate` 消息。

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

决策行为：

| 决策 | 输出行为 |
|---|---|
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留；当前仅作为报告候选 |
| `remove_candidate` | 仅在非 protected 时移除 |

### `trimctx resume`

查找 `~/.claude/projects/` 下最近修改的 `.jsonl` 会话并分析。

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

`resume` 面向 Claude Code 本地会话目录；它不会发现 `~/.claude/projects/` 之外的 OpenAI 文件。

## 支持的输入

| 输入 | 状态 |
|---|---|
| Claude Code JSONL | 已支持 |
| OpenAI Chat Completion 风格 JSONL | 已支持 |
| 纯文本转录 | 不支持 |
| 数据库或远程 API | 不支持 |

## 安全模型

trimctx 会保护可能仍然重要的内容：

- `system` 和 `developer` 消息
- 配置的最近消息窗口内的消息
- 类似“记住”“从现在开始”“不要忘记”的记忆类指令
- 用户明确决策和纠正
- 代码块、错误栈、文件路径、shell 命令和 git diff
- 测试失败和调试证据
- 架构、API、schema 和配置变更
- 被后续自然语言总结引用的工具结果

要验证 `compress` 没有修改原文件，可以在运行前后比较 hash：

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

两次 `session.jsonl` 的 hash 应一致。

## 当前限制

- `compress_candidate` 当前只是报告候选；trimctx 不会改写或摘要消息内容。
- token 数是本地近似估算，不等同于特定模型 tokenizer 的精确结果。
- Phase 0 还需要更多真实长会话验证，不应过早信任激进默认值。
- trimctx 当前没有 Web UI、MCP server、数据库、安装器或 Claude Code slash command。

## 文档

- [使用说明](docs/usage_zh.md) — 详细命令示例、输出和安全检查
- [路线图](docs/roadmap.md) — 计划里程碑和发布标准
- [需求说明](docs/requirements.md) — 项目范围、约束和验收标准
- [当前状态](docs/status-and-next-steps.md) — 实现状态和下一步

## 开发

```bash
npm install
npm test
npm run build
```

## 许可证

[MIT](LICENSE)
