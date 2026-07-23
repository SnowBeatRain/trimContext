# trimctx

**用于审查并安全精简 AI 长对话上下文的本地 CLI。**

trimctx 读取 Claude Code、OpenAI 和 Codex/Hermes JSONL transcript，识别陈旧或低价值上下文，生成可审计的会话健康报告，并可写出保守的压缩副本。它不会修改原始 transcript，也不调用 LLM。

安全原则：宁可少删，也不要误删。

[English](README.md)

## 快速开始

要求 Node.js 20+。

```bash
npm install -g trimctx
trimctx init --target user
trimctx analyze path/to/session.jsonl
trimctx report path/to/session.jsonl -o report.md
```

`report.md` 是推荐给人工审查的报告。使用 `compress` 或生成续聊包前，请先阅读它。

自动化流程使用稳定的 JSON 入口：

```bash
trimctx report path/to/session.jsonl -o report.json
trimctx analyze path/to/session.jsonl --json
```

两者产生相同的 `trimctx.report.v2` JSON 值。`report` 还支持 `.md`；其他扩展名会被拒绝。

## 健康状态语义

- `healthy` 表示现有证据下上下文风险较低，不是删除许可。
- `attention` 和 `degraded` 表示存在需要审查或高置信风险。
- `unknown` 表示证据不足，不能描述为“干净”。
- Protected 内容永不自动删除。
- 每条 `remove_candidate` 都必须是非 protected，并包含 reasons 和决定性证据。

短摘要只使用报告 assessment、最多两条 finding、续接缺失项和第一条 recommendation。完整 Markdown 与 JSON 报告才是审计依据。

## 命令

### 分析

```bash
trimctx analyze path/to/session.jsonl
trimctx analyze path/to/session.jsonl --json
trimctx analyze --select
trimctx analyze --latest
trimctx analyze --latest --source claude
trimctx analyze --latest --source codex
```

存在可信 `TRIMCTX_TRANSCRIPT_PATH` 绑定时，不带文件的 `trimctx analyze` 会分析该 transcript。显式 `--select` 和 `--latest` 只选择文件，不会恢复或切换 AI 客户端窗口。

### 报告

```bash
trimctx report path/to/session.jsonl -o report.md
trimctx report path/to/session.jsonl -o report.json
```

- Markdown 面向人工审查，包含结论、健康维度、关键发现、审查队列、protected 陈旧信号、续接状态、限制和下一步。
- JSON 是完整的 v2 机器可读报告，与 `analyze --json` 一致。
- Markdown 证据摘要会脱敏并限制长度，但完整 JSON 报告和续聊包仍可能包含原始对话内容，分享前必须审查。
- 报告采用原子写入，并拒绝输入文件本身或它的别名。

### 新会话续接

```bash
trimctx new-chat path/to/session.jsonl
trimctx new-chat path/to/session.jsonl --out .trimctx/handoffs
```

命令会在 `.trimctx/handoffs/<uid>/` 写出 `handoff.md`、`next-context.md`、`manifest.json`、`report.json` 和 `README.md`。`manifest.json` 记录输入 hash、文件路径、健康状态/置信度和报告 schema 版本，包内报告为 v2。

把 `next-context.md` 粘贴到新 AI 窗口前先审查。UID 只是本地引用，不是恢复令牌。

多窗口时优先传入明确的 JSONL 路径。Claude Code 安装 hooks 后，`/trimctx:new-chat` 使用当前窗口的 `TRIMCTX_TRANSCRIPT_PATH`；Codex 尚无经过验证的当前窗口自动绑定，不要用无文件参数的 `new-chat` 或 `--latest` 猜测当前窗口。生成后可检查 `manifest.json` 的 `input.file`、`session_id` 和 `sha256`。

### 压缩

```bash
trimctx compress path/to/session.jsonl -o session.trimmed.jsonl
```

压缩只写新 JSONL，只移除非 protected 的 `remove_candidate`。`keep`、`keep_protected` 和 `compress_candidate` 都会保留。请先审查报告。

### 安装客户端资产

```bash
trimctx init --target user
trimctx init --client claude --target user
trimctx init --client codex --target user
trimctx init --target project --dir .
trimctx init --with-hooks --target user
trimctx init --dry-run --target user
```

Hooks 只通过 `trimctx init --with-hooks` 显式安装。

## Claude Code

打包插件提供：

- `/trimctx`：分析 hooks 绑定的当前 transcript
- `/trimctx:analyze`：分析显式 JSONL 路径
- `/trimctx:new-chat`：为当前 transcript 生成续聊包
- `/trimctx:compress`：仅在用户明确要求压缩时使用

`/trimctx` 执行：

```bash
trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color
```

绑定缺失时会停止，不会猜测其他 session。

同时打开多个 Claude Code 窗口时，每个窗口的 SessionStart hook 都通过该窗口自己的 `CLAUDE_ENV_FILE` 写入 `TRIMCTX_TRANSCRIPT_PATH` 和 `TRIMCTX_SESSION_ID`。安装 hooks 后需要重启每个已打开窗口；当前窗口命令不要替换为 `--latest`。同一项目多个窗口共享 `.claude/CLAUDE.md`，因此其中的状态区块可能由最后触发 Stop hook 的窗口更新，但这不会改变各窗口的 transcript 绑定。

Hooks 写入范围：

- SessionStart 通过 `CLAUDE_ENV_FILE` 写入当前 `transcript_path`，供 `TRIMCTX_TRANSCRIPT_PATH` 使用。
- Stop 只可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的区块。
- 原始 JSONL transcript 始终只读。

## Codex

包内提供 Codex skill/CLI 工作流。单窗口发现可使用 `--select` 或 `--latest --source codex`；多窗口时二者都不能自动证明“当前窗口”，必须把确认后的 JSONL 路径显式传给 `analyze`、`report`、`new-chat` 或 `compress`。本项目不宣称已验证 Codex `/trimctx` slash command，也不宣称已验证当前窗口 transcript 绑定。

## 支持的输入

| 格式 | 状态 |
| --- | --- |
| Claude Code JSONL | 支持 |
| OpenAI JSONL | 支持 |
| Codex/Hermes rollout JSONL | 支持 |
| 纯文本、数据库、远程 API | 不支持 |

## 安全验证

```bash
sha256sum session.jsonl
trimctx compress session.jsonl -o session.trimmed.jsonl
sha256sum session.jsonl
```

两次输入 hash 必须一致。真实 transcript 和生成的私有报告不得提交到仓库或进入 npm 包。

现有工作流已验证可用，但这不等于 `phase0_trust` 已锁定。任何“无需人工审查即可安全压缩”的对外承诺，仍必须满足 `docs/dev/phase0/phase0-plan.md` 的正式发布门槛。

## 开发

```bash
npm install
npm test
npm run build
```

更多信息见 [docs/user/usage_zh.md](docs/user/usage_zh.md)、[docs/dev/requirements.md](docs/dev/requirements.md) 和 [docs/dev/roadmap.md](docs/dev/roadmap.md)。

## 许可证

MIT
