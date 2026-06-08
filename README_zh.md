# trimctx

本地 AI 长对话上下文精简工具。读取 Claude Code / OpenAI JSONL 对话记录，识别过时、重复、低价值、未引用的上下文内容，输出可审计报告，并生成安全的压缩副本。

**核心原则：宁可少删，也不要误删。** `compress` 永远不会修改原始 JSONL 文件。

[English](README.md)

## 功能

- **分析**对话中的过时、被覆盖、低价值消息
- **报告**完整的 JSON 报告，包含每条消息的评分和原因
- **压缩**安全地生成新文件，不触碰原始文件
- **本地优先** — 无网络请求、不调用 LLM、不上传数据
- **可审计** — 每个候选都有人类可读的原因说明
- 支持 **Claude Code JSONL** 和 **OpenAI JSONL** 格式

## 快速开始

```bash
npm install -g trimctx
```

分析对话：

```bash
trimctx analyze path/to/session.jsonl
```

生成完整报告：

```bash
trimctx report path/to/session.jsonl -o report.json
```

生成安全压缩副本：

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

## 安装

### 从 npm 安装（发布后）

```bash
npm install -g trimctx
```

### 从源码构建

需要 Node.js 20+。

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

从源码运行：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

构建后运行：

```bash
node dist/cli.js analyze path/to/session.jsonl
```

## 命令

### `trimctx analyze <file>`

分析 JSONL 对话文件，输出摘要到终端。

- 默认：人类可读的短摘要
- `--json`：完整 JSON 报告

### `trimctx report <file> -o <report.json>`

输出完整 JSON 报告，包含每条消息的 token 数、决策、原因和评分。

### `trimctx compress <file> -o <output.jsonl>`

写入新的 JSONL 文件，仅排除可安全删除的消息。`-o` 参数必填。

| 决策 | 行为 |
|---|---|
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留（v0.1 不删除） |
| `remove_candidate` | 删除（仅当非 protected 时） |

## 支持的格式

| 格式 | 状态 |
|---|---|
| Claude Code JSONL | 已支持 |
| OpenAI Chat Completion JSONL | 已支持 |
| 纯文本 / 数据库 / 远程 API | 不支持 |

## 安全模型

以下内容默认保护，不会被压缩删除：

- `system` / `developer` 消息
- 最近 6 轮 `user` / `assistant` 消息
- 代码块、错误栈、文件路径、shell 命令、git diff
- 测试失败信息
- 记忆类指令（"记住"、"从现在开始"、"不要忘记"）
- 用户明确决策
- 架构 / API / schema / 配置变更
- 被后续自然语言总结引用的关键 tool_result

## 文档

- [使用说明](docs/usage.md) — 详细的安装、命令和输出格式说明
- [路线图](docs/roadmap.md) — 版本里程碑和发布标准

## 开发

```bash
npm install
npm test
npm run build
```

贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
