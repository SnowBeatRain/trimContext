## Why

trimctx 已能分析会话并生成健康报告或续接文档，但现有 Markdown 产物都服务于审查或交接，只展示摘要、证据片段或启发式提取结果。用户还需要一个独立入口，把受支持 JSONL 中解析器可识别的完整会话内容按原顺序导出为可阅读、可审计的 Markdown，而不经过 scorer、threshold 或报告脱敏逻辑。

现有 `report.md` 的契约是脱敏且限长的健康报告，不能扩展成全文导出；`new-chat` 也不是会话归档。应新增语义独立的公开命令，并继续保持原始 transcript 只读。

## What Changes

- 新增 `trimctx export [file] -o <conversation.md>` 公开命令；省略文件时只使用可信的当前窗口绑定，不做 latest fallback，且不保留旧 `transcript` 命令别名。
- 按解析器产出的规范化消息顺序生成事件账本式 Markdown，保留正文、角色、ID、源行、时间戳、父消息与工具关联等可用信息。
- 正文不评分、不筛选、不截断、不脱敏；使用动态长度 Markdown 围栏隔离任意 Markdown、HTML 与代码围栏内容。
- 文档记录输入路径、SHA-256、格式、session ID、消息数、隐私警告和格式归一化边界。
- 只允许 `.md` 输出，拒绝输入文件及其别名，保持输入句柄打开并原子替换目标文件。
- 在 Claude Code 插件中新增 `/trimctx:export` 当前窗口入口，并在 Codex skill 中补充显式文件用法和多窗口边界。
- 将公开命令面从五个更新为六个，并同步用户文档、开发文档、发布记录和 packed-install smoke。

## Core Features

- 独立生成完整规范化会话 Markdown，不改变 `analyze`、`report`、`new-chat` 或 `compress` 契约。
- 三种受支持输入格式共享现有自动检测与解析器，并保留解析后的完整消息顺序和正文。
- 对任意正文安全、确定性地生成结构稳定的 Markdown。
- 复用现有文件身份检查与原子写入，确保原始 JSONL 只读且失败不破坏已有目标。
- CLI、Claude Code、Codex 文档和 npm packed-install 路径一致可用。

## Capabilities

### New Capabilities

- `conversation-transcript-export`：把解析器识别的全部规范化会话消息导出为私密 Markdown 事件账本。
- `conversation-transcript-integration`：通过公开 CLI、Claude Code 插件和 Codex skill 暴露明确、安全的全文导出流程。

### Modified Capabilities

- `cli-command-surface`：公开命令面由五个扩展为六个，新增 `export`，其余命令行为保持不变。

## Impact

- CLI 注册与命令实现：`src/commands/index.ts`、新建 `src/commands/export.ts`。
- 纯解析和渲染：复用 `src/core/analyzer.ts`，新建 `src/core/transcript-markdown.ts`。
- 文件安全：复用 `src/platform/files.ts`，不改变其公共行为。
- 测试：新增 `tests/transcript-markdown.test.ts` 与 `tests/cli-export.test.ts`，更新 CLI surface、客户端资产和 packed-install smoke。
- 文档与资产：README、双语 usage、开发主线文档、Changelog、Claude plugin 的 `plugins/trimctx/commands/trimctx/export.md`、Codex skill。
- 不修改 report schema、scorer、threshold、safety 或 compressor。

## Non-Goals

- 不提供原始 JSONL 的逐字节备份或 round-trip 恢复能力。
- 不把 Codex 加密 reasoning、运行时 event/turn 元数据或解析器当前不识别的载荷宣称为已导出对话。
- 不自动脱敏、总结、调用 LLM、上传内容或把正文打印到 stdout。
- 不增加角色过滤、时间范围、分页、HTML/PDF/JSON 等额外导出选项。
- 不通过 `--latest` 或修改时间猜测当前窗口。
- 不调整现有分析、报告、续接和压缩行为。

## Open Questions

None
