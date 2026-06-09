# trimctx 项目需求文档

## 1. 项目背景

AI 编程工具在长会话中会积累大量上下文，包括旧工具调用、重复解释、被后续修正覆盖的方案、历史 metadata 和不再相关的输出。上下文越来越长后，会降低模型响应质量，增加 token 成本，也让用户难以判断当前会话是否健康。

trimctx 的目标是提供一个本地、可审计、保守的上下文精简工具，让用户先看报告，再决定是否生成压缩副本。

## 2. 一句话需求

trimctx 读取本地 Claude Code / OpenAI JSONL 对话文件，分析每条消息的安全性和腐烂程度，输出报告，并生成不会修改原文件的安全压缩副本。

## 3. 目标用户

- 使用 Claude Code / Codex / Cursor 等 AI 编程工具的开发者。
- 经常运行长任务、长调试、长重构会话的用户。
- 需要在开源或团队环境中审计上下文清理结果的工具作者。

## 4. 核心目标

- 离线分析本地长对话文件。
- 识别 protected / keep / compress_candidate / remove_candidate。
- 每条候选都必须有 reason。
- 输出完整 JSON 报告。
- 输出安全压缩副本。
- 原始 JSONL 永远不被修改。
- 默认不调用 LLM，不上传用户数据。

## 5. 非目标

- 不做聊天工具。
- 不做新的 Agent 框架。
- 不做 Web 平台。
- 不自动删除原始文件。
- 不默认调用 LLM 或 embedding。
- 不在 v0.1 做 MCP / REST API / Dashboard。
- 不追求第一版删得最多。

## 6. 功能需求

### FR-1: 解析输入文件

必须支持：

- Claude Code JSONL
- OpenAI JSONL

解析结果统一为 `NormalizedMessage`，包含：

- id
- role
- content
- source
- sourceLine
- rawLine
- raw
- timestamp
- sessionId
- parentId
- tool 信息

### FR-2: token 统计

每条 message 必须有 token 估算值，summary 必须包含总 tokens。

v0.1 使用近似 tokenizer，后续可替换为更精确 tokenizer。

### FR-3: safety rules

系统必须先执行保护规则，再执行 scorer。

必须保护：

- system / developer
- 最近 30 条消息
- 代码块
- 错误栈
- 文件路径
- shell 命令
- git diff
- 测试失败信息
- 记忆类指令
- 用户明确决策
- 架构 / API / schema / 配置变更
- 被后续自然语言总结引用的关键 tool_result

### FR-4: scorer

scorer 必须输出：

- `superseded_score`
- `low_reference_score`
- `age_score`
- `redundancy_score`
- `orphan_tool_score`
- `low_value_score`
- `rot_score`

决策规则：

```text
protected => keep_protected
rot_score >= 0.80 => remove_candidate
rot_score >= 0.60 => compress_candidate
otherwise => keep
```

### FR-5: report

`report` 必须输出完整 JSON，包含：

- schema_version
- input
- summary
- messages
- remove_candidates
- warnings

每条 message 必须包含：

- tokens
- protected
- rot_score
- scores
- decision
- reasons

### FR-6: analyze

当前行为：

- `analyze <file>` 默认输出短摘要。
- `analyze <file> --json` 输出完整 JSON。

### FR-7: compress

`compress <file> -o <output.jsonl>` 必须：

- 写入新文件。
- 不修改原文件。
- 不删除 protected。
- 不删除 keep。
- 不删除 compress_candidate。
- 只删除非 protected 的 remove_candidate。
- 拒绝把输出路径写成输入文件本身。

如果没有 `-o`，命令必须失败。

## 7. 非功能需求

- 本地优先：默认不联网、不上传数据。
- 可审计：所有候选都有 reason。
- 保守安全：critical false deletion 必须为 0。
- 可测试：核心模块必须有自动化测试。
- 可移植：Node.js 20+，优先支持 Windows，后续覆盖 macOS / Linux。
- 可开源：真实 transcript 不进入仓库。

## 8. 数据需求

Phase 0 至少需要 5 个真实 Claude Code 长会话私有样本：

- 功能开发
- Bug 调试
- 重构任务
- 文档/规划
- 长工具调用任务

最低总量：

- 总 messages >= 600
- 总 tokens >= 200k
- 至少 1 个 session 含大量 tool_result
- 至少 1 个 session 发生过 compact
- 至少 1 个 session 有用户后续纠正前面要求

私有数据必须放在 `datasets/private/`，不得提交到开源仓库。

## 9. 验收标准

### v0.1 验收

- `npm test` 通过。
- `npm run build` 通过。
- 至少一个真实 Claude Code 长会话能解析。
- report summary 字段完整。
- 每条 remove_candidate 都有 reasons。
- compress 输出新文件。
- 输入文件 hash 不变。
- protected 消息不会被删除。

### Phase 0 验收

- 成功解析 5 个真实 Claude Code JSONL。
- 每个 session 都能输出 report。
- remove_candidate precision >= 70%。
- protected recall = 100%。
- critical false deletion = 0。
- parser success rate >= 95%。

## 10. 当前优先级

1. `analyze` 默认短摘要。
2. `analyze --json`。
3. report top reasons 和 warnings。
4. JSONL 解析诊断与 unsafe output path 护栏。
5. Phase 0 多样本验证和 validation summary。
6. 基于真实样本结果调整 safety/scorer 默认值。
7. 等 Phase 0 完成后再评估是否需要额外 session discovery / diagnostics 命令。

## 11. 文档关系

- 本文档定义“要做什么”。
- `docs/usage.md` 说明“怎么使用”。
- `docs/roadmap.md` 说明“按什么阶段推进”。
- `docs/execution-plan.md` 说明“怎么落地执行”。
- `docs/status-and-next-steps.md` 记录“当前进度和下一步”。

