# 使用说明

本文档介绍 trimctx CLI 的安装、命令和使用方式。

[English](usage.md)

## 环境要求

- Node.js 20 或更高版本

## 安装

### npm 安装（发布后可用）

```bash
npm install -g trimctx
```

### 从源码构建

```bash
git clone https://github.com/trimctx/trimctx.git
cd trimctx
npm install
npm run build
```

## 快速开始

```bash
trimctx analyze path/to/session.jsonl
```

预期输出：

```text
trimctx analysis

messages: 633
tokens: 218,385
protected: 338
remove candidates: 41
compress candidates: 30
estimated saving: 5,592 tokens (2.56%)

top reasons:
- recent_message: 241
- superseded_by_later_instruction: 195
- old_message: 190

next:
- trimctx report <file> -o report.json
- trimctx compress <file> -o output.jsonl
```

## 命令

### `trimctx analyze <file>`

分析 JSONL 对话文件并输出摘要。

**选项：**

| 参数 | 说明 |
|---|---|
| `--json` | 输出完整 JSON 报告而非摘要 |

```bash
# 短摘要（默认）
trimctx analyze session.jsonl

# 完整 JSON 报告
trimctx analyze session.jsonl --json
```

### `trimctx report <file> -o <report.json>`

将完整 JSON 报告写入文件。报告包含：

- **input** — 输入文件元信息
- **summary** — 消息总数、token 数、保护数量、候选数、预计节省量
- **messages** — 每条消息的 token 数、决策、原因和评分
- **remove_candidates** — 可安全删除的消息列表
- **warnings** — 分析过程中遇到的问题

```bash
trimctx report session.jsonl -o report.json
```

### `trimctx compress <file> -o <output.jsonl>`

生成对话的压缩副本。仅排除非 protected 的 `remove_candidate` 消息。

**原始文件永远不会被修改。**

`-o` 参数为必填项——必须指定输出路径。

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

**删除规则：**

| 决策 | 行为 |
|---|---|
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留（v0.1 不删除） |
| `remove_candidate` | 删除，仅当非 protected 时 |

## 支持的输入格式

| 格式 | 状态 |
|---|---|
| Claude Code JSONL | 已支持 |
| OpenAI Chat Completion JSONL | 已支持 |

## 安全模型

trimctx 默认保护以下内容，这些消息永远不会被删除：

- `system` / `developer` 消息
- 最近 6 轮 `user` / `assistant` 消息
- 代码块、错误栈、文件路径、shell 命令、git diff
- 测试失败信息
- 记忆类指令（"记住"、"从现在开始"、"不要忘记"）
- 用户明确决策
- 架构 / API / schema / 配置变更
- 被后续自然语言总结引用的关键 tool_result

## 安全验证

运行 `compress` 后，验证原始文件未被修改：

```bash
# Linux / macOS
sha256sum session.jsonl

# Windows PowerShell
Get-FileHash -Algorithm SHA256 -LiteralPath "session.jsonl"
```

在 `compress` 前后各运行一次哈希校验——两次结果必须一致。

## 评分维度

每条消息在多个维度上进行评分：

| 维度 | 说明 |
|---|---|
| `superseded_score` | 后续消息覆盖或纠正了早期指令 |
| `low_reference_score` | 后续消息未引用此消息 |
| `age_score` | 基于在对话中位置的指数衰减 |
| `redundancy_score` | 与相邻消息高度相似 |
| `orphan_tool_score` | 工具调用/结果与后续上下文无关联 |
| `low_value_score` | 元信息、确认回复或低信息量内容 |

综合 `rot_score` 决定最终决策：

```text
protected => keep_protected
rot_score >= 0.80 => remove_candidate
rot_score >= 0.60 => compress_candidate
otherwise => keep
```

## 当前限制

- `analyze` 摘要输出在 v0.2+ 可用；v0.1 输出完整 JSON
- 暂无自动会话发现（`latest` / `sessions` 计划在 v0.2）
- 暂无环境诊断（`doctor` 计划在 v0.2）
- 暂无 AI 工具集成（计划在 v0.3+）
