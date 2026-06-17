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

  trust:
    0 remove candidates means nothing crossed the safe deletion threshold.
    compress candidates, if any, are report-only and kept by default.
    max score: 0.6428; near threshold: 0

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
    trimctx report "~/.claude/projects/my-project/abc123.jsonl" -o report.json
    trimctx analyze "~/.claude/projects/my-project/abc123.jsonl" --json
```

## 快速开始

**需要 Node.js 20+。**

从 npm 安装，然后安装 AI 客户端可识别的命令文件：

```bash
npm install -g trimctx
trimctx init
```

`trimctx init` 会询问安装到当前用户全局位置，还是安装到当前项目。用户全局安装会把 Claude Code slash commands 写入 `~/.claude/plugins/trimctx`，把 Codex skill 写入 `~/.codex/skills/trimctx`。之后重启 AI 客户端，在 Claude Code 里运行 `/trimctx`，或让 Codex 使用 trimctx skill。

也可以继续使用 GitHub 一条命令安装：

Windows CMD：

> 如果提示 `'irm' 不是内部或外部命令`，说明你在 CMD，不是在 PowerShell，请用下面这条 CMD 命令。

```bat
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex"
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 | iex
```

macOS / Linux / WSL：

```bash
curl -fsSL https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh | bash
```

然后重启 Claude Code，直接运行：

```text
/trimctx
```

Windows 上默认写入：

- `trimctx.cmd` / `trimctx.ps1` 到 `%USERPROFILE%\.local\bin`
- Claude Code 插件到 `%USERPROFILE%\.claude\plugins\trimctx`
- 源码 checkout 到 `%LOCALAPPDATA%\trimctx`

macOS / Linux 上默认写入：

- `trimctx` 到 `~/.local/bin/trimctx`
- Claude Code 插件到 `~/.claude/plugins/trimctx`
- 源码 checkout 到 `~/.local/share/trimctx`

如果 shell 找不到 `trimctx`，把下面这行加入 shell profile：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

本地开发时也可以从源码链接：

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
npm link
trimctx --help
```

仅通过 npm 安装时：

```bash
npm install -g trimctx
trimctx init --client all
trimctx init --target user --client all
trimctx --help
```

写出完整 JSON 报告用于审查：

```bash
trimctx report path/to/session.jsonl -o report.json
```

生成压缩副本（原文件不动）：

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

生成继续交接文档：

```bash
trimctx handoff path/to/session.jsonl -o handoff.md --next-context next-context.md
```

自动分析最新的 Claude Code 或 Codex 会话：

```bash
trimctx current
trimctx current --source claude
trimctx current --source codex
```

使用旧兼容别名分析最新 Claude Code 会话：

```bash
trimctx resume
```

安装 AI 客户端命令文件：

```bash
trimctx init                 # 交互选择用户全局或项目级安装
trimctx init --target user --client claude    # 只为当前用户安装 Claude Code commands
trimctx init --target user --client codex     # 只为当前用户安装 Codex skill
trimctx init --target project --dir .
```

在 Claude Code 中使用：

- `trimctx init` 会提示选择用户全局或项目级安装；`--target user` 会把 `plugins/trimctx/` 安装到 `~/.claude/plugins/trimctx`。
- 插件提供 `/trimctx`、`/trimctx:analyze`、`/trimctx:resume`、`/trimctx:compress` 命令文件。
- 安全边界：`/trimctx` 按文件修改时间分析最新本地 JSONL；不会写回 Claude Code，不会修改原始会话，只在用户明确触发时压缩。

在 Codex 中使用：

- `trimctx init` 会提示选择用户全局或项目级安装；`--target user` 会把 `codex/skills/trimctx/SKILL.md` 安装到 `~/.codex/skills/trimctx`。
- 运行 `trimctx current --source codex` 可分析 `~/.codex/sessions/` 下最新本地 Codex JSONL。
- 这里明确是 skill/CLI 集成，不宣传为已验证的 Codex `/trimctx` slash command。

如果要从源码开发，请克隆仓库并运行本地 TypeScript 入口：

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
npm run dev -- analyze path/to/session.jsonl
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

### `trimctx init`

从 npm 包安装 AI 客户端命令文件与 skill。

```bash
trimctx init
trimctx init --client claude --force
trimctx init --client codex --target project --dir .
trimctx init --dry-run
```

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `--client <client>` | `all` | `claude`、`codex` 或 `all` |
| `--target <target>` | 提示选择 | `user` 安装到 home 目录下；`project` 安装到 `--dir` 或当前目录下 |
| `--dir <directory>` | home/当前目录 | 覆盖基础目录 |
| `--force` | `false` | 覆盖已有 trimctx 资产 |
| `--dry-run` | `false` | 只打印计划路径，不写文件 |

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

`compress_candidate` 是有意保守的信号：它表示 trimctx 发现了过期或低价值迹象，但还没有足够证据安全删除该消息。某些格式，尤其是 Codex/Hermes rollout 文件，在默认阈值下可能产生 0 条 `remove_candidate`；这应视为安全优先的结果，而不是 parser 失败。

### `trimctx handoff <file> -o <handoff.md>`

写出确定性的 Markdown 交接文档，帮助在长会话或噪音会话后安全继续工作，不修改原始 JSONL。

```bash
trimctx handoff session.jsonl -o handoff.md --next-context next-context.md
```

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
- JSON 报告包含 `summary.score_diagnostics`，用于在调整阈值前查看评分分布；诊断字段不会改变压缩行为。
- token 数是本地估算，不等同于特定模型 tokenizer 的精确计数。
- Claude Code 和 Codex/Hermes rollout 路径已用本地样本验证；真实多样本验证仍在进行中，OpenAI 还需要用户提供真实导出样本后，Phase 0 才能覆盖所有已支持来源。建议先审查报告，再使用压缩输出。
- 默认阈值优先避免误删，而不是最大化 token 节省；只有在用私有验证样本审查报告后，才建议下调阈值。
- 暂无 Web UI、MCP server 或独立安装器。Claude Code 已通过项目命令文件和插件包装支持；Codex 已通过 skill/CLI 工作流支持，不宣传为已验证的 slash command。

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
