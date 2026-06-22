# 使用说明

本文档说明如何安全地在本地 Claude Code、OpenAI 或 Codex/Hermes rollout JSONL 对话文件上运行 trimctx。

[English](usage.md)

## 环境要求

- Node.js 20 或更高版本
- 来自 Claude Code、OpenAI 风格聊天导出或 Codex/Hermes rollout 导出的 JSONL 对话文件

trimctx 是本地工具：不调用 LLM、不上传文件、不使用数据库。Token 计算也保持本地：内置 `local_heuristic` 是默认 tokenizer；安装可选 `js-tiktoken` 后，OpenAI 风格和 Codex/Hermes rollout 输入可以使用本地精确计数且不调用厂商 API。Claude Code 输入保持启发式估算，直到后续接入 Claude 兼容的本地 tokenizer。

如果你全局安装 `trimctx` 且希望启用精确 `tiktoken` 计数，请把 `js-tiktoken` 安装到 CLI 能解析到的同一环境；或者在项目内同时本地安装 `trimctx` 和 `js-tiktoken`。

## 安装

### GitHub 一条命令安装

该路径不需要把 trimctx 发布到 npm。

Windows CMD：

> 如果 CMD 提示 `'pwsh' is not recognized`，可改用 `powershell`。执行前请先审阅下载到本地的脚本。

```bat
pwsh -NoProfile -Command "Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1"
type install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

Windows PowerShell：

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.ps1 -OutFile install.ps1
Get-Content install.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

macOS / Linux / WSL：

```bash
curl -fsSLO https://raw.githubusercontent.com/SnowBeatRain/trimContext/main/install.sh
less install.sh
bash install.sh
```

Windows 上默认把 CLI shim 安装到 `%USERPROFILE%\.local\bin`，把 Claude Code 插件安装到 `%USERPROFILE%\.claude\plugins\trimctx`，并把源码 checkout 保存在 `%LOCALAPPDATA%\trimctx`。

macOS / Linux 上默认把 CLI 安装到 `~/.local/bin/trimctx`，把 Claude Code 插件安装到 `~/.claude/plugins/trimctx`，并把源码 checkout 保存在 `~/.local/share/trimctx`。

安装后重启 Claude Code，然后运行：

```text
/trimctx
```

如果 shell 找不到 `trimctx`，把 `~/.local/bin` 加入 `PATH`：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 从源码运行

```bash
git clone https://github.com/SnowBeatRain/trimContext.git
cd trimContext
npm install
npm run build
```

开发时运行源码 CLI：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
```

运行 `npm run build` 后使用编译产物：

```bash
node dist/cli.js analyze path/to/session.jsonl
```

### npm 安装

安装 CLI 后，再安装 AI 客户端命令文件：

```bash
npm install -g trimctx
trimctx init
trimctx analyze path/to/session.jsonl
```

`trimctx init` 会从 npm 包安装 Claude Code 命令文件和 Codex skill。省略 `--target` 时会询问安装到用户全局位置还是当前项目；写入前可先用 `trimctx init --dry-run` 查看路径。

## 快速开始

分析文件并输出短摘要：

```bash
trimctx analyze path/to/session.jsonl
```

典型摘要形态：

```text
trimctx analysis

messages: 633
tokens: 218,385
protected: 338
remove candidates: 41
compress candidates: 30
estimated saving: 5,592 tokens (2.56%)

trust:
- 0 remove candidates means nothing crossed the safe deletion threshold.
- compress candidates, if any, are report-only and kept by default.
- max score: 0.6428; near threshold: 0

top reasons:
- recent_message: 241
- superseded_by_later_instruction: 195
- old_message: 190

next:
- trimctx report <file> -o report.json
- trimctx compress <file> -o output.jsonl
```

压缩前建议先写出完整 JSON 报告：

```bash
trimctx report path/to/session.jsonl -o report.json
```

审查报告后，再生成压缩副本：

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

生成后续会话使用的交接文档：

```bash
trimctx handoff path/to/session.jsonl -o handoff.md --next-context next-context.md
```

## 推荐流程

1. 运行 `analyze`，确认 trimctx 是否找到了有意义的候选。
2. 运行 `report`，检查 `remove_candidate` 消息的原因。
3. 保留原始 JSONL 文件不变。
4. 运行带 `-o` 的 `compress`，创建新文件。
5. 如果需要安全证据，在压缩前后比较原文件 hash。

```bash
sha256sum session.jsonl
trimctx report session.jsonl -o report.json
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

两次 `session.jsonl` 的 hash 应一致。

## 面向共享使用的 Phase 0 验证

如果计划把 trimctx 推荐给其他用户，或验证发布候选版本，先运行私有多样本验证流程：

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

验证流程见 `docs/dev/phase0/phase0-plan.md`、`docs/dev/phase0/manual-label-guide.md` 和 `docs/dev/phase0/validation-summary-template.md`。

`reports/phase0/phase0-results.json` 默认视为私有产物。它可能包含本机路径以及捕获到的 `stderr` 或 `error` 细节；对外只发布脱敏摘要或人工删改后的片段。

## 命令

### `trimctx init`

从已安装包中安装 AI 客户端命令文件与 skill。

```bash
trimctx init
trimctx init --client claude
trimctx init --client codex --target project --dir .
trimctx init --dry-run
```

默认情况下，`trimctx init` 会提示选择用户全局或项目级安装。传入 `--target user` 时，Claude Code 资产写入 `~/.claude/plugins/trimctx`，Codex skill 写入 `~/.codex/skills/trimctx`。已有资产不会被覆盖，除非传入 `--force`。

### `trimctx analyze <file>`

分析 Claude Code、OpenAI 或 Codex/Hermes rollout JSONL 对话，并输出终端摘要。

```bash
trimctx analyze session.jsonl
```

选项：

| 参数 | 说明 |
|---|---|
| `--json` | 输出完整 JSON 报告，而不是短摘要 |
| `--color` | 给终端摘要加颜色 |
| `--recent-window <count>` | 硬保护最近 N 条消息，默认 `30` |
| `--remove-threshold <score>` | `remove_candidate` 的 `rot_score` 阈值，默认 `0.80` |
| `--compress-threshold <score>` | `compress_candidate` 的 `rot_score` 阈值，默认 `0.60` |

示例：

```bash
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

### `trimctx report <file> -o <report.json>`

写出完整 JSON 报告。

```bash
trimctx report session.jsonl -o report.json
```

报告包含：

- `input` — 输入文件元信息
- `summary` — 消息数、token 估算、protected 数量、候选数、预计节省量和评分诊断
- `tokenization` — tokenizer 名称和置信度；`local_heuristic` 表示本地估算。安装可选 `js-tiktoken` 后，OpenAI 风格和 Codex/Hermes rollout 输入可使用高置信本地精确计数；Claude Code 输入仍保持启发式估算，因为当前未内置 Claude 兼容的本地 tokenizer。
- `messages` — 每条消息的 token 估算、决策、原因和评分
- `remove_candidates` — 按当前阈值选出的可安全移除消息
- `warnings` — 解析或分析过程中遇到的问题

`summary.score_diagnostics` 用于阈值调优和验证，包含 `max_rot_score`、`p90_rot_score`、`near_remove_threshold_count`、`protected_high_rot_count` 和 `decision_score_ranges`。这些诊断字段不会改变消息决策或压缩行为。

### `trimctx compress <file> -o <output.jsonl>`

创建新的 JSONL 文件。`-o` 参数必填。

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

`compress` 只移除非 protected 的 `remove_candidate` 消息。它会保留 `compress_candidate` 消息，因为当前这些候选只用于报告。

如果报告里有 `compress_candidate`，但没有 `remove_candidate`，parser 和 scorer 仍可能是正常工作的。这表示消息达到了报告阈值，但没有达到更严格的删除阈值。对于 Codex/Hermes rollout 这类安全敏感或真实标注样本还不充分的格式，这是符合预期的保守结果。

| 决策 | 行为 |
|---|---|
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留；仅报告候选 |
| `remove_candidate` | 仅在非 protected 时移除 |

### `trimctx handoff <file> -o <handoff.md>`

写出确定性的 Markdown 交接文档，帮助在长会话或噪音会话后安全继续工作，不修改原始 JSONL。

```bash
trimctx handoff session.jsonl -o handoff.md --next-context next-context.md
```

主交接文档包含输入元信息、安全诊断、继续执行规则、候选审查队列、警告和下一步命令。可选的 `--next-context` 会写出更短的上下文包，供另一个 Agent 或会话使用。

`handoff.md` 输出结构示例：

```markdown
# trimctx Handoff

## Source
- File: path/to/session.jsonl
- Format: claude-code-jsonl
- Messages: 633
- Estimated tokens: 218385

## Safety Summary
- Remove candidates: 41
- Compress candidates: 30
- Protected messages: 338
- Estimated removable tokens: 5592
- Max rot score: 0.6428
- Near remove threshold: 0

## Continue From Here
- Treat `remove_candidate` as the only class eligible for destructive workflows...
- Treat `compress_candidate` as report-only review signal...
- Keep original JSONL unchanged...
- If remove candidates are zero, continue from the health report...

## Candidate Review Queue
- line 42, user, score 0.8500: old_message, low_reference_in_later_context
- line 58, assistant, score 0.8200: superseded_by_later_instruction, old_message
...

## Protected High-Rot Signals
- line 301, user, score 0.6500: contains_code_block, old_message

## Warnings
- session_compacted: session contains away_summary or compact_boundary markers

## Commands
- `trimctx analyze "path/to/session.jsonl"`
- `trimctx report "path/to/session.jsonl" -o report.json`
- `trimctx compress "path/to/session.jsonl" -o trimmed.jsonl`
```

`next-context.md` 输出结构示例：

```markdown
# Next Context

Use this as the compact handoff for the next agent or session.

## Current State
- Source file: path/to/session.jsonl
- Source format: claude-code-jsonl
- Messages analyzed: 633
- Remove candidates: 41
- Compress candidates: 30

## Operating Rules
- Do not modify the original JSONL file.
- Review remove candidates before applying any destructive workflow.
- Use score diagnostics as trust signals, not as automatic tuning instructions.

## Next Commands
- `trimctx analyze "path/to/session.jsonl"`
- `trimctx report "path/to/session.jsonl" -o report.json`
- `trimctx handoff "path/to/session.jsonl" -o handoff.md --next-context next-context.md`
```

### `trimctx current`

分析本地客户端会话目录中最近修改的 Claude Code 或 Codex `.jsonl` 会话。

```bash
trimctx current
trimctx current --source auto
trimctx current --source claude
trimctx current --source codex
trimctx current --json
trimctx current --compress session.trimmed.jsonl
```

`--source auto` 会扫描 Claude Code 项目会话根目录与 Codex 会话根目录，并选择最新 JSONL 文件。`--source claude` 只扫描 `~/.claude/projects/`；`--source codex` 只扫描 `~/.codex/sessions/`。

### `trimctx resume`

分析 `~/.claude/projects/` 下最近修改的 Claude Code `.jsonl` 会话。

```bash
trimctx resume
trimctx resume --json
trimctx resume --compress session.trimmed.jsonl
```

`resume` 使用 Claude Code 的本地会话目录。如果该目录没有会话文件，它会报错退出。它不会扫描任意目录。

## 客户端集成

### Claude Code

本仓库包含项目级命令文件，位置在 `.claude/commands/`：

- `.claude/commands/trimctx.md` 暴露 `/trimctx`，用于分析最新 Claude Code 或 Codex 会话。
- `.claude/commands/trimctx/analyze.md` 暴露 `/trimctx:analyze <file>`。
- `.claude/commands/trimctx/resume.md` 暴露 `/trimctx:resume`。
- `.claude/commands/trimctx/compress.md` 暴露 `/trimctx:compress`。

npm 包还包含 `plugins/trimctx/`，这是同一套命令文件的 Claude Code 插件包装。这些命令会调用 `trimctx` 可执行文件，所以需要全局安装 CLI，或在本地开发时运行 `npm link`。

安全边界：这些命令分析导出的/本地 JSONL 文件；不安装 hooks，不写回 Claude Code 会话，也不会默认压缩。只有用户选择 `/trimctx:compress` 或带 `--compress` 的 CLI 命令时才会写出压缩副本。

### Codex

包内包含 `codex/skills/trimctx/SKILL.md`，提供 Codex 支持的 skill 入口来调用同一套 CLI 工作流。这里不把它宣传为已验证的 Codex `/trimctx` slash command；请使用 skill，或直接运行 `trimctx current --source codex`。Codex 发现逻辑当前只扫描 `~/.codex/sessions/`。

## 支持的输入格式

| 格式 | 状态 |
|---|---|
| Claude Code JSONL | 已支持 |
| OpenAI Chat Completion 风格 JSONL | 已支持 |
| Codex/Hermes rollout JSONL | 已支持 |
| 纯文本转录 | 不支持 |
| 远程 API 或数据库 | 不支持 |

## 报告决策

| 决策 | 含义 |
|---|---|
| `keep_protected` | 被安全规则保护的高风险或近期内容 |
| `keep` | 未达到候选阈值的内容 |
| `compress_candidate` | 可能低价值，但当前 compressor 不会移除 |
| `remove_candidate` | 非 protected 且达到移除阈值的内容 |

## 评分维度

每条消息可能在以下维度上获得评分：

| 维度 | 权重 | 说明 |
|---|---:|---|
| `superseded_score` | 0.30 | 后续消息覆盖或纠正了早期指令 |
| `low_reference_score` | 0.25 | 后续上下文没有引用该消息 |
| `age_score` | 0.20 | 越旧的消息衰减越高 |
| `redundancy_score` | 0.15 | 与相邻内容（±3 条）相似 |
| `orphan_tool_score` | 0.10 | 工具调用或结果与后续上下文无关联 |
| `low_value_score` | — | 元信息、确认回复或低信息量内容（独立路径，不参与加权） |

综合公式：

```text
base_rot_score = 0.30 × superseded + 0.25 × low_reference + 0.20 × age + 0.15 × redundancy + 0.10 × orphan_tool
rot_score = max(base_rot_score, low_value_score) − importance_discount
```

重要性折扣（从 `rot_score` 中扣减，使重要内容更难被删除）：

| 保护信号 | 折扣值 |
|---|---:|
| 代码块、错误栈、git diff、测试失败 | −0.15 |
| Shell 命令、架构/API/配置决策 | −0.10 |
| 被后续引用的工具结果 | −0.10 |
| 文件路径 | −0.05 |
| 引用工具结果的自然语言 | −0.05 |

决策映射：

```text
protected => keep_protected
rot_score >= 0.80 => remove_candidate
rot_score >= 0.60 => compress_candidate
otherwise => keep
```

默认 `0.80` 删除阈值是有意设置得较高。只有在私有验证运行中人工审查过生成报告、并能接受更激进候选时，才建议降低阈值。

调整阈值或评分权重前，应先查看 `summary.score_diagnostics`。如果 `compress_candidate` 明显低于删除阈值，且 `near_remove_threshold_count` 为 `0`，保守结果通常是符合预期的，而不是漏删。

## 当前限制

- `compress_candidate` 不会被改写成摘要。
- token 数是本地估算，不是特定模型 tokenizer 的精确计数。
- 当前不包含 Web UI、MCP server 或独立安装器。Claude Code 命令/plugin 包装已包含；Codex 支持是 skill/CLI 形式，而不是已验证的 slash command。
- 真实长会话验证仍在进行中，因此建议先审查报告，再把压缩输出当作替代上下文使用。
