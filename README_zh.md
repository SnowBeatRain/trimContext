# trimctx

**本地优先的 CLI，用于分析和安全精简 AI 长对话上下文。**

当你使用 Claude Code、Codex、Cursor 或其他 AI 助手连续工作数小时，对话历史会积累大量过期内容——旧报错、被覆盖的指令、孤立的工具输出、元信息噪音。这就是**上下文腐化（context rot）**：对话越来越慢、越来越贵，模型开始拉入不相关的历史。

trimctx 读取你的 JSONL 对话文件，识别低价值或过期消息，解释原因，生成安全的压缩副本——**永远不修改原文件**。

**安全原则：trimctx 宁可少删，也不要误删。**

[English](README.md)

## 长什么样

```
$ trimctx analyze ~/.claude/projects/my-project/abc123.jsonl

trimctx analysis

  633 messages / 218K tokens
  health: MODERATE  rot: 10.8% (68 candidates)

  breakdown:
    remove:       41 messages (5.6K tokens)
    compress:     27 messages
    protected:    338 messages
    saving:       5.6K tokens (2.6%)

  top reasons:
    - metadata noise: 18
    - old content: 15
    - superseded: 12
    - orphan tool result: 8
    - low reference: 6

  next:
    trimctx compress "~/.claude/projects/my-project/abc123.jsonl" -o trimmed.jsonl
    trimctx analyze "~/.claude/projects/my-project/abc123.jsonl" --json
```

## 快速开始

**需要 Node.js 20+。**

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

分析一个对话：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

写出完整 JSON 报告用于审查：

```bash
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
```

生成压缩副本（原文件不动）：

```bash
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

自动分析最新的 Claude Code 会话：

```bash
npx tsx src/cli.ts resume
```

## 谁适合用

- **Claude Code / Codex / Cursor 用户** — 长时间运行的会话触及上下文限制
- **开发者** — 想了解 AI 上下文窗口被什么内容占满
- **团队** — 在归档前审查和压缩共享的对话日志

## 工作原理

1. **解析** — 自动识别 Claude Code JSONL、OpenAI JSONL 和 Codex/Hermes rollout JSONL 格式。
2. **归一化** — 统一消息结构、tool-use 块、tool result 和元事件。
3. **保护** — 将高风险内容标记为 protected（system prompt、最近消息、用户决策、代码、错误、diff、配置变更、记忆指令）。
4. **评分** — 基于消息年龄、重复度、后续引用度、孤立工具输出、元信息噪音等维度给剩余消息打分。
5. **报告** — 输出人类可读摘要和包含逐条决策与原因的完整 JSON 报告。
6. **压缩** — 写出新 JSONL，只排除非 protected 的 `remove_candidate` 消息。

## 命令

### `trimctx analyze <file>`

输出终端摘要或完整 JSON 报告。

```bash
trimctx analyze session.jsonl
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `--json` | `false` | 输出完整 JSON 而不是终端摘要 |
| `--color` | `false` | 终端输出加颜色 |
| `--recent-window <N>` | `30` | 硬保护最近 N 条消息 |
| `--remove-threshold <score>` | `0.80` | 标记为 `remove_candidate` 的最低 rot_score |
| `--compress-threshold <score>` | `0.60` | 标记为 `compress_candidate` 的最低 rot_score |

### `trimctx report <file> -o <report.json>`

写出完整 JSON 报告，包含逐条消息的决策、评分、原因和警告。

```bash
trimctx report session.jsonl -o report.json
```

### `trimctx compress <file> -o <output.jsonl>`

写出安全压缩副本。原文件永远不被修改。

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

| 决策 | 行为 |
|---|---|
| `keep_protected` | 始终保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留（当前仅报告） |
| `remove_candidate` | 仅在非 protected 时移除 |

### `trimctx resume`

查找并分析 `~/.claude/projects/` 下最近修改的 Claude Code 会话。

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

## 支持的输入

| 格式 | 状态 |
|---|---|
| Claude Code JSONL | 已支持 |
| OpenAI Chat Completion 风格 JSONL | 已支持 |
| Codex/Hermes rollout JSONL | 已支持 |
| 纯文本转录 | 不支持 |
| 数据库或远程 API | 不支持 |

## 安全模型

trimctx 保护可能仍然重要的内容：

- `system` 和 `developer` 消息
- 最近 N 条消息（可配置，默认 30）
- 记忆类指令（"记住"、"从现在开始"、"不要忘记"）
- 用户明确决策和纠正
- 代码块、错误栈、文件路径、shell 命令和 git diff
- 测试失败和调试证据
- 架构、API、schema 和配置变更
- 被后续对话引用的工具结果

**验证原文件未被修改：**

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
# 两次 hash 应一致。
```

## 当前限制

- `compress_candidate` 消息保持原样（暂不改写或摘要）。
- token 数是本地估算，不等同于特定模型 tokenizer 的精确计数。
- Claude Code 和 Codex/Hermes rollout 路径已用本地样本验证；真实多样本验证仍在进行中，OpenAI 还需要用户提供真实导出样本后，Phase 0 才能覆盖所有已支持来源。建议先审查报告，再使用压缩输出。
- 暂无 Web UI、MCP server、安装器或 Claude Code slash command。

## 文档

- [使用说明](docs/usage_zh.md) — 详细命令示例、输出和安全验证
- [路线图](docs/roadmap.md) — 计划里程碑和功能
- [需求说明](docs/requirements.md) — 项目范围和验收标准

## Phase 0 验证

在推荐给其他用户使用前，建议先用私有多样本数据集验证：

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

详见 `docs/phase0/phase0-plan.md`、`docs/phase0/manual-label-guide.md` 和 `docs/phase0/validation-summary-template.md`，按安全优先流程完成验证。

## 开发

```bash
npm install
npm test
npm run build
```

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境、代码规范和 PR 流程。

## 许可证

[MIT](LICENSE)
