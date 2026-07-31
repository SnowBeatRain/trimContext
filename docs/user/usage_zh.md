# trimctx 使用指南

trimctx 是本地、确定性的 CLI，用于分析 Claude Code、OpenAI 和 Codex/Hermes JSONL transcript。它不调用 LLM、不上传 transcript，也不修改原始 JSONL。

## 安装

要求 Node.js 20+。

```bash
npm install -g trimctx
trimctx --version
trimctx init --target user
```

只有需要 Claude 当前窗口绑定时才安装 hooks：

```bash
trimctx init --target user --with-hooks
```

## 推荐流程

1. 分析会话。
2. 生成并审查 Markdown 报告。
3. 自动化或深入审计时使用 JSON。
4. 只有需要完整对话时才导出全部规范化 transcript。
5. 审查后再生成续聊包或压缩副本。

```bash
trimctx analyze path/to/session.jsonl
trimctx report path/to/session.jsonl -o report.md
trimctx report path/to/session.jsonl -o report.json
trimctx export path/to/session.jsonl -o conversation.md
trimctx new-chat path/to/session.jsonl
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

`healthy` 不是删除许可。`unknown` 表示证据不足，不表示会话干净。Protected 消息永不自动删除。

## Analyze

```bash
trimctx analyze <file>
trimctx analyze <file> --json
trimctx analyze --select
trimctx analyze --latest
trimctx analyze --latest --source claude
trimctx analyze --latest --source codex
```

终端短摘要读取 v2 assessment，最多显示两条 finding，列出续接缺失证据，并只显示第一条 recommendation。内部 score 和 token breakdown 不在短摘要中展示。

不带文件时，`analyze` 只接受可信的 `TRIMCTX_TRANSCRIPT_PATH` 绑定。`--select` 和 `--latest` 是显式发现模式。选择 JSONL 不会恢复或切换 AI 客户端窗口。

完整 `trimctx.report.v2` 使用 `--json`。

## Report

输出文件必须以 `.md` 或 `.json` 结尾，大小写不敏感。

```bash
# 人工审查
trimctx report session.jsonl -o report.md

# 自动化
trimctx report session.jsonl -o report.json
trimctx analyze session.jsonl --json
```

`report.json` 与 `analyze --json` 深度相等。JSON 会格式化并以换行结尾。

Markdown 报告包含：结论和置信度、健康维度、关键发现、审查队列、protected 陈旧项、可信续接状态、限制与安全说明、下一步。

展示的 evidence 只包含 message id、source line、role 和最长 160 字符的脱敏摘要。token、邮箱、key/value 密钥和 Basic Auth 凭据会被脱敏，Markdown 表格中的竖线和换行会转义。这不代表所有生成物都能直接分享，分享前仍须审查。

报告使用同目录临时文件和原子替换。命令拒绝输入文件及其别名；渲染或写入失败时保留已有报告；替换前会重新检查打开的输入句柄。

## Export

```bash
trimctx export session.jsonl -o conversation.md
trimctx export -o conversation.md # 仅限可信的当前窗口绑定
```

该命令按现有 parser 返回顺序写出每一条 `NormalizedMessage`，不执行 tokenizer、safety、scorer、threshold、report 脱敏、筛选或截断。`trimctx.transcript.v1` 文档保留角色、ID、源行，以及可用的时间戳、父消息、session 和工具关联元数据。

Markdown 默认未脱敏，可能包含系统指令、凭据、本地路径、源码以及完整工具输入或结果。应把它视为私密本地产物，分享前必须审查。它是 parser-normalized transcript，不是原始 JSONL 的逐字节备份：Claude 内容块可能合并，重复流式帧可能去重；Codex 加密 reasoning 和 parser 忽略的运行时 event/turn 记录不会导出。

输出必须以 `.md` 结尾，大小写不敏感。命令拒绝输入文件及其别名，采用原子替换，不把消息正文打印到 stdout，并保持原始 JSONL 只读。省略 `[file]` 时只接受有效的 `TRIMCTX_TRANSCRIPT_PATH` 当前窗口绑定，绝不回退到 latest session。

## New Chat

```bash
trimctx new-chat session.jsonl
trimctx new-chat session.jsonl --out custom-root
```

默认写入 `.trimctx/handoffs/<uid>/`：`handoff.md`、`next-context.md`、`manifest.json`、`report.json` 和 `README.md`。

`manifest.json` 保留源文件 hash 和文件列表，并增加 `health_status`、`health_confidence`、`report_schema_version`。包内 `report.json` 为 v2。candidate/protected 段落保持 report review queue 的顺序，续接段落使用可信 resume 证据。

分享或粘贴到新窗口前必须审查。包内可能包含原始 transcript 内容和密钥。UID 只是本地包引用，不是恢复令牌。

## 多窗口与当前会话

显式传入的 `<file>` 始终是命令的数据来源。多窗口环境不要把“最近修改的 session”当成“当前窗口”。

Claude Code 安装 hooks 后，SessionStart 会把该窗口的 `transcript_path` 和 `session_id` 写入该窗口自己的 `CLAUDE_ENV_FILE`，形成 `TRIMCTX_TRANSCRIPT_PATH` / `TRIMCTX_SESSION_ID` 绑定。安装后应重启每个已经打开的 Claude Code 窗口。`/trimctx`、`/trimctx:export`、`/trimctx:new-chat` 和 `/trimctx:compress` 都使用绑定路径；缺少绑定时停止，不回退到其他 session。无文件参数的 `trimctx analyze` 和 `trimctx export -o conversation.md` 还会检查绑定路径可读、确实是文件，并在存在 session ID 时校验它与 transcript 文件名一致。

同一项目的多个 Claude Code 窗口共享 `.claude/CLAUDE.md`。Stop hook 的受管状态区块可能由最后停止的窗口更新，但不会改变每个窗口自己的 transcript 绑定。

Codex 当前没有经过验证的自动窗口绑定：

- `--latest --source codex` 选择所有本地 Codex session 中最近修改的文件，不保证属于当前窗口。
- `--select --source codex` 是人工选择，也不是自动绑定。
- 无文件参数的 `trimctx new-chat` 在缺少绑定时可能回退到最近 session，多窗口 Codex 中不要使用这种形式。
- 需要严格对应当前 Codex 窗口时，把确认后的 JSONL 路径显式传给每个命令。

```powershell
trimctx analyze --select --source codex
trimctx analyze "C:\Users\name\.codex\sessions\...\rollout.jsonl"
trimctx export "C:\Users\name\.codex\sessions\...\rollout.jsonl" -o conversation.md
trimctx new-chat "C:\Users\name\.codex\sessions\...\rollout.jsonl"
```

生成续聊包后检查 `.trimctx/handoffs/<uid>/manifest.json` 中的 `input.file`、`session_id` 和 `sha256`，确认来源正确后再在新窗口使用。UID 需要在同一项目目录或明确的 `--out` 目录下解析。

## Compress

```bash
trimctx compress session.jsonl -o session.trimmed.jsonl
```

压缩只写新文件，不修改输入。它只移除非 protected 的 `remove_candidate`。Protected、`keep` 和 `compress_candidate` 都保留。候选项仍需审查，健康状态不授权删除。

## Claude Code 插件

```bash
trimctx init --client claude --target user --with-hooks
```

重启 Claude Code 后：

- `/trimctx` 执行 `trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color`。
- `/trimctx:analyze` 接受显式 JSONL 文件。
- `/trimctx:export` 把当前会话的未脱敏 transcript 写到 `conversation.md`。
- `/trimctx:new-chat` 生成当前会话续聊包。
- `/trimctx:compress` 只在用户明确要求时写出独立副本。

缺少 `TRIMCTX_TRANSCRIPT_PATH` 时，当前窗口命令会停止，不会猜测其他 session。

Hooks 写入范围：

- SessionStart 通过 `CLAUDE_ENV_FILE` 写入 `transcript_path` 和会话绑定数据。
- Stop 只可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的区块。
- 原始 JSONL transcript 始终只读。

## Codex Skill

```bash
trimctx init --client codex --target user
```

使用显式文件、`trimctx analyze --select --source codex` 或 `trimctx analyze --latest --source codex`。完整导出使用 `trimctx export <file.jsonl> -o conversation.md`，并传入确认后的路径。多窗口时必须显式确认并传入 JSONL 路径；`--latest` 和 `--select` 都不代表自动当前窗口绑定。包内说明的是 skill/CLI 工作流，不宣称已验证 Codex `/trimctx` slash command 或当前窗口绑定。

## Report v2

顶层字段包括 `schema_version`、`input`、`summary`、`tokenization`、`parser_diagnostics`、`phase0_trust`、`resume`、`assessment`、`findings`、`review_queue`、`candidate_groups`、`recommendations`、`analysis_meta`、messages/candidate 数组和 `warnings`。

JSON 报告是完整审计数据，可能包含消息正文。私有报告不得进入 git 或 npm 包。

## 支持的输入

| 格式 | 状态 |
| --- | --- |
| Claude Code JSONL | 支持 |
| OpenAI JSONL | 支持 |
| Codex/Hermes rollout JSONL | 支持 |
| 纯文本 | 不支持 |

## 故障排查

### 没有当前绑定

传入显式文件，使用 `--select`/`--latest`，或运行 `trimctx init --with-hooks` 后重启 Claude Code。

### 报告输出被拒绝

使用 `.md` 或 `.json`，并选择与输入 transcript 不同的路径。

### Export 输出被拒绝

使用 `.md`，选择与输入 transcript 不同的路径；没有可信当前窗口绑定时显式传入输入文件。

### remove candidate 为零

这可能是保守的安全结果。审查 findings 和 limitations，不要在公开 CLI 示例中降低内部阈值。

### 验证输入未改变

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

两次 hash 必须一致。
