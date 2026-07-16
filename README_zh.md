# trimctx

**本地优先的 CLI，用于分析和安全精简 AI 长对话上下文。**

当你使用 Claude Code、Codex、Cursor 或其他 AI 助手连续工作数小时，对话历史会积累大量过期内容——旧报错、被覆盖的指令、孤立的工具输出、元信息噪音。这就是**上下文腐化（context rot）**：对话越来越慢、越来越贵，模型开始拉入不相关的历史。

trimctx 读取你的 JSONL 对话文件，识别低价值或过期消息，解释原因，生成安全的压缩副本——**永远不修改原文件**。

**安全原则：trimctx 宁可少删，也不要误删。**

**发布里程碑：** 当前 `0.2` 系列把续接感知报告、new-chat/next-context 产物、面向 OpenAI/Codex-family 输入的可选精确 `tiktoken` 计数、AI 客户端安装说明，以及 npm 包 smoke 检查整合成 npm-ready release。它仍保持保守边界：Phase 0 还需要更多真实样本验证和人工评审指标后才算完成。

[English](README.md)

## 快速开始

```bash
npm install -g trimctx
trimctx init
trimctx
trimctx new-chat
```

`trimctx` 会优先分析 hooks 绑定的当前 Claude Code transcript；没有当前绑定时，交互式终端会打开本地会话选择器，非交互环境则会失败并要求显式指定文件或使用 `trimctx analyze --latest`。选择本地 transcript 只会分析文件，不会恢复或切换 AI 客户端窗口。`trimctx new-chat` 会生成 `.trimctx/handoffs/<id>/` 本地续聊包，把其中的 `next-context.md` 复制到新 AI 窗口即可续接。`trimctx handoff` 仍保留为兼容别名。


**需要 Node.js 20+。**

从 npm 安装，然后直接分析一个会话并准备 AI 客户端资产：

```bash
npm install -g trimctx
trimctx new-chat
trimctx init
```

`trimctx analyze` 用于查看短摘要，`trimctx report` 用于输出完整 JSON 审计报告，`trimctx compress` 则建议在审查报告后再使用。

## 长什么样

```
$ trimctx analyze ~/.claude/projects/my-project/abc123.jsonl

trimctx analysis

  633 messages / 218K tokens
  token estimate: heuristic-v1 (local_heuristic, medium confidence)
  tokenizer: local_heuristic (medium confidence)
  context pressure: HIGH  removable: 5.6K tokens (2.6%)
  health: MODERATE  rot: 10.8% (68 candidates)

  trust:
    41 remove candidates crossed the safe deletion threshold.
    review the JSON report before applying destructive workflows.
    phase0: REVIEW_REQUIRED
    candidates are review-only until Phase 0 gates are locked.
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
    trimctx report "~/.claude/projects/my-project/abc123.jsonl" -o report.json
    run Phase 0 manual review before using compress output as replacement context
    trimctx analyze "~/.claude/projects/my-project/abc123.jsonl" --json
```

## 安装

```bash
npm install -g trimctx
trimctx --version
trimctx --help
trimctx init
```

`trimctx init` 会询问安装到当前用户全局位置，还是安装到当前项目。用户全局安装会把 Claude Code slash commands 写入 `~/.claude/plugins/trimctx`，把 Codex skill 写入 `~/.codex/skills/trimctx`。在交互流程中，它还会询问是否启用 Claude 当前窗口 hooks，默认建议启用。非交互安装仍需要传入 `--with-hooks` 才会安装 hooks。

如果要在 Claude Code 当前会话窗口里使用 `/trimctx`、`/trimctx:new-chat` 或 `/trimctx:compress`，请在交互式 `trimctx init` 中启用 hooks，或运行 `trimctx init --with-hooks` / `trimctx install-hooks`，然后重启 Claude Code。SessionStart hook 会通过 `CLAUDE_ENV_FILE` 把当前窗口的 `transcript_path` 写入 `TRIMCTX_TRANSCRIPT_PATH`；同时安装的 Stop hook 可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块。

也可以继续使用 GitHub 一条命令安装：

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

日常核心流程：

```bash
trimctx init
trimctx current
trimctx new-chat
```

- `trimctx init` 安装 Claude Code 插件和 Codex skill 文件。
- `trimctx current` 只分析 AI 客户端 hooks 绑定的当前窗口 transcript。
- `trimctx new-chat [file]` 生成可用 UID 引用的继续交接包。

Claude Code 当前窗口流程：

```bash
trimctx init
# 重启 Claude Code，然后在 Claude Code 里运行：
/trimctx
/trimctx:new-chat
```

需要更深入排查时，再使用 `trimctx analyze <file>` 查看指定文件摘要，或用 `trimctx report <file> -o report.json` 写出完整 JSON 审计报告。`trimctx compress` 只建议在审查报告后使用；压缩仍保持保守，并且永远不修改原文件。

## 续接感知交接

`trimctx analyze`、`trimctx report` 和 `trimctx current` 会在报告中包含本地续接状态。提取器基于规则，不调用外部 LLM 或 API。

续接状态是长会话后的最佳努力、启发式续接辅助：

- `tokenization` 记录 token 计算使用的 tokenizer 名称和置信度。默认使用本地启发式 tokenizer；安装可选 `js-tiktoken` 后，OpenAI 风格和 Codex/Hermes rollout 输入可以使用本地精确 `tiktoken` 计数且不调用厂商 API。
- `resume.readiness` 评估会话是否包含足够续接信号。
- `resume.currentGoal`、`decisions`、`activeFiles`、`failures`、`testSignals` 和 `nextSteps` 会保留压缩后可能需要的续接线索。
- `trimctx new-chat [file]` 会在 `.trimctx/handoffs/<uid>/` 下写出基于 UID 的完整交接包，包含 `handoff.md`、`next-context.md`、`manifest.json` 和 `report.json`。在已安装 hooks 的 Claude Code 中，`/trimctx:new-chat` 会直接调用不带文件参数的 `trimctx new-chat`，因为当前窗口的路径已注入到 `TRIMCTX_TRANSCRIPT_PATH`。
- 输出的 `uid` 便于复制引用，但 trimctx 当前没有 `resume <uid>` 或等效恢复命令。

原始 JSONL 会话仍然只读。Resume 提取只影响报告和生成的 Markdown 产物。分享或粘贴到另一个会话前，请人工审查生成的 handoff；规则提取可能遗漏、误分类或脱敏不完美。

交互选择本地会话，或显式分析最近会话：

```bash
trimctx analyze --select
trimctx analyze --latest
trimctx analyze --latest --source claude
trimctx analyze --latest --source codex
```

选择 transcript 不会执行 `/resume`，也不会恢复或切换 AI 客户端窗口。

安装 AI 客户端命令文件：

```bash
trimctx init                 # 交互选择用户全局或项目级安装
trimctx init --target user --client claude    # 只为当前用户安装 Claude Code commands
trimctx init --target user --client codex     # 只为当前用户安装 Codex skill
trimctx init --target project --dir .
trimctx init --with-hooks    # 实验性：同时安装 Claude 当前窗口 hooks
trimctx init --no-hooks      # 交互流程中跳过 Claude hooks
trimctx install-hooks        # 实验性：只安装 hooks
```

在 Claude Code 中使用：

- `trimctx init` 会提示选择用户全局或项目级安装；`--target user` 会把 `plugins/trimctx/` 安装到 `~/.claude/plugins/trimctx`。
- 插件提供 `/trimctx`、`/trimctx:analyze`、`/trimctx:new-chat`、`/trimctx:compress` 命令文件。
- `/trimctx`、`/trimctx:new-chat` 和 `/trimctx:compress` 依赖 `TRIMCTX_TRANSCRIPT_PATH`；该变量由交互式 `trimctx init`、`trimctx init --with-hooks` 或 `trimctx install-hooks` 安装的 Claude `SessionStart` hook 写入。
- 安全边界：`trimctx current` 和当前窗口插件命令都要求 hook 绑定，绝不 fallback 到最近文件。如果绑定缺失，命令会停止并提示安装 hooks。hooks 永远不修改原始 transcript；Stop hook 只可能更新 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块，压缩仍只在用户明确触发时执行。

在 Codex 中使用：

- `trimctx init` 会提示选择用户全局或项目级安装；`--target user` 会把 `codex/skills/trimctx/SKILL.md` 安装到 `~/.codex/skills/trimctx`。
- 运行 `trimctx analyze --latest --source codex` 可分析 `~/.codex/sessions/` 下最近的本地 Codex JSONL；用 `trimctx analyze --select --source codex` 可交互选择。
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

### 核心命令

#### `trimctx init`

从 npm 包安装 AI 客户端命令文件与 skill。在交互终端中省略 `--target` 时，`trimctx init` 会先询问用户级或项目级安装，再询问是否启用 Claude 当前窗口 hooks，默认建议启用。非交互安装不会自动安装 hooks，除非传入 `--with-hooks`。

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
| `--with-hooks` | `false` | 实验性：同时安装 Claude 当前窗口 hooks |
| `--no-hooks` | `false` | 交互式 init 中跳过 Claude hook 安装 |

#### `trimctx current`

只分析 AI 客户端当前窗口绑定的 transcript。绑定通常由 Claude Code SessionStart hooks 提供；该命令不会 fallback 到最新文件发现。

```bash
trimctx current
trimctx current --json
```

#### `trimctx new-chat [file]`

写出确定性的 Markdown 交接文档，帮助在长会话或噪音会话后安全继续工作，不修改原始 JSONL。

```bash
trimctx new-chat session.jsonl
trimctx new-chat   # 使用当前/最近的本地 AI 会话
```

默认会创建 `.trimctx/handoffs/<uid>/`，其中包含 `handoff.md`、`next-context.md`、`manifest.json` 和 `report.json`。UID 使用 UTC 时间（`ctx_YYYYMMDD_HHMMSS_xxxxxx`）并以 `copyable uid: ...` 输出，方便直接复制引用。`manifest.json` 同时包含本机自动化可用的绝对路径，以及便于移动或归档 package 的相对文件名。可用 `--out <dir>` 指定自定义 package 根目录；旧版单文件输出仍可通过 `-o handoff.md --next-context next-context.md` 使用。交接包可能在 `report.json` 中包含原始会话内容和密钥，分享前请先审查。这里的 UID 目前只是引用标识，不是内置恢复令牌；trimctx 还没有 `resume <uid>` 或等效命令。

### 诊断命令

#### `trimctx analyze [file]`

输出终端摘要或完整 JSON 报告。

```bash
trimctx analyze session.jsonl
trimctx analyze   # 仅当当前 AI 客户端已设置 TRIMCTX_TRANSCRIPT_PATH 时使用
trimctx analyze --select
trimctx analyze --latest --source codex
trimctx analyze session.jsonl --json
trimctx analyze session.jsonl --recent-window 20 --remove-threshold 0.85
```

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `--json` | `false` | 输出完整 JSON 而不是终端摘要 |
| `--color` | `false` | 终端输出加颜色 |
| `--select` | `false` | 交互选择已知的本地 Claude/Codex 会话 |
| `--latest` | `false` | 分析已知本地目录中最近修改的会话 |
| `--source <source>` | `auto` | 过滤 `--select` 或 `--latest`：`auto`、`claude`、`codex` |
| `--recent-window <N>` | `30` | 硬保护最近 N 条消息 |
| `--remove-threshold <score>` | `0.80` | 标记为 `remove_candidate` 的最低 rot_score |
| `--compress-threshold <score>` | `0.60` | 标记为 `compress_candidate` 的最低 rot_score |

### 高级审计命令

#### `trimctx report <file> -o <report.json>`

写出完整 JSON 报告，包含逐条消息的决策、评分、原因、警告、顶层 `phase0_trust` 和顶层 `parser_diagnostics`。

```bash
trimctx report session.jsonl -o report.json
```

### 实验性压缩命令

#### `trimctx compress <file> -o <output.jsonl>`

写出安全压缩副本。原文件永远不被修改。

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

| 决策 | 行为 |
|---|---|
| `keep_protected` | 始终保留 |
| `keep` | 保留 |
| `compress_candidate` | 保留（当前仅报告） |
| `remove_candidate` | 仅在非 protected 时从副本移除；Phase 0 gates locked 前仅作为人工审查候选 |

`compress_candidate` 是有意保守的信号：它表示 trimctx 发现了过期或低价值迹象，但还没有足够证据安全删除该消息。`remove_candidate` 在 Phase 0 trust locked 前也只是人工审查候选。某些格式，尤其是 Codex/Hermes rollout 文件，在默认阈值下可能产生 0 条 `remove_candidate`；这应视为安全优先的结果，而不是 parser 失败。

### 实验性集成命令

#### `trimctx hook`

作为 Claude Code hook 执行器运行，不是主要用户分析入口。作为 Stop hook 时，它要求 Claude hook 输入包含 `transcript_path`，不会降级扫描最新文件，并可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块；`--dry-run` 不写文件。作为内部 SessionStart hook 时，`trimctx hook --session-start` 会通过 `CLAUDE_ENV_FILE` 把当前 `transcript_path` 和 `session_id` 持久化为 `TRIMCTX_TRANSCRIPT_PATH` 和 `TRIMCTX_SESSION_ID`，让 slash command 能定位当前 Claude 窗口，而不要求用户提供 JSONL 路径。

#### `trimctx install-hooks`

把实验性的 Claude Code SessionStart 和 Stop hooks 安装到 `settings.json`。SessionStart 通过 `CLAUDE_ENV_FILE` 写当前会话绑定；Stop 可能维护 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块。当资产已经安装、只需要补装或修复 hooks 时使用它。交互式 `trimctx init` 可在安装流程中安装同一套 hooks；非交互 init 需要传入 `--with-hooks`。

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
- token 数默认使用零依赖本地启发式估算。安装可选 `js-tiktoken` 后，OpenAI 风格和 Codex/Hermes rollout 输入可使用本地精确 `tiktoken` 计数，不调用厂商 API。
- 已支持路径已经过真实项目工作流验证；后续私有验证用于回归记录，不再作为继续 CLI 稳定化和重构的前置条件。
- `trimctx current` 是严格的当前窗口分析，依赖 hook 注入的 `TRIMCTX_TRANSCRIPT_PATH`。Codex 当前窗口 transcript 绑定目前没有已验证的公开支持说明；Codex 本地发现使用 `analyze --select/--latest`。
- 默认阈值优先避免误删，而不是最大化 token 节省；只有在用私有验证样本审查报告后，才建议下调阈值。
- 当前不包含 Web UI 或 MCP server。CLI 安装脚本及 Claude Code/Codex 打包资产已经提供；Codex 仍定位为 skill/CLI 工作流，不宣传为已验证的 slash command。

## 文档

- [使用说明](docs/user/usage_zh.md) — 详细命令示例、输出和安全验证
- [路线图](docs/dev/roadmap.md) — 计划里程碑和功能
- [需求说明](docs/dev/requirements.md) — 项目范围和验收标准

## Phase 0 验证

在推荐给其他用户使用前，建议先用私有多样本数据集验证：

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

详见 `docs/dev/phase0/phase0-plan.md`、`docs/dev/phase0/manual-label-guide.md` 和 `docs/dev/phase0/validation-summary-template.md`，按安全优先流程完成验证。

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
