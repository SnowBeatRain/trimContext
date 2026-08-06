# trimctx 项目需求文档

## 1. 项目背景

AI 编程工具在长会话中会积累大量上下文，包括旧工具调用、重复解释、被后续修正覆盖的方案、历史 metadata 和不再相关的输出。上下文越来越长后，会降低模型响应质量，增加 token 成本，也让用户难以判断当前会话是否健康。

trimctx 的目标是提供一个本地、可审计、保守的上下文精简工具，让用户先看报告，再决定是否生成压缩副本。

## 2. 一句话需求

trimctx 读取本地 Claude Code / OpenAI / Codex JSONL 对话文件，分析每条消息的安全性和腐烂程度，输出报告，并生成不会修改原文件的安全压缩副本。

## 3. 目标用户

- 使用 Claude Code / Codex / Cursor 等 AI 编程工具的开发者。
- 经常运行长任务、长调试、长重构会话的用户。
- 需要在开源或团队环境中审计上下文清理结果的工具作者。

## 4. 核心目标

- 离线分析本地长对话文件。
- 识别 protected / keep / compress_candidate / remove_candidate。
- 每条候选都必须有 reason。
- 输出面向人工审查的 Markdown 报告和完整 JSON 报告。
- 输出包含全部规范化消息的未脱敏 Markdown transcript。
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
- 不把规范化 transcript 宣称为原始 JSONL 的逐字节备份。

## 6. 功能需求

### FR-1: 解析输入文件

必须支持：

- Claude Code JSONL
- OpenAI JSONL
- Codex/Hermes rollout JSONL

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

`report <file> -o <output>` 只接受 `.md` 或 `.json`。Markdown 用于人工审查；JSON 必须与 `analyze --json` 深度一致，并使用 `trimctx.report.v2`。

Phase 0 必须对两个独立成功命令的完整 JSON 值做语义绑定：对象键顺序和格式不计入差异，数组顺序和所有字段值必须一致，不设置字段白名单。私有 canonical SHA-256 只用于本地 runner/review 对账，公开 review 只输出匹配数和固定 issue。

Phase 0 还必须把首次记录的输入 SHA-256 传给 `analyze`、`report` 和 `compress` 子进程，并对每条命令实际解析的同一 Buffer 校验摘要。任一命令消费了不同字节都必须 fail closed，且 report/compress 不得写入新目标；普通 CLI 不设置内部期望摘要时保持现有行为。

v2 JSON 至少包含：

- schema_version
- input
- summary
- messages
- remove_candidates
- warnings
- assessment
- findings
- review_queue
- recommendations
- resume

每条 message 必须包含：

- tokens
- protected
- rot_score
- scores
- decision
- reasons

Markdown 必须包含结论、健康维度、关键发现、审查队列、Protected 但疑似陈旧、续接状态、限制与安全说明和下一步。证据只展示 message id、line、role 和脱敏且不超过 160 字符的摘要。

当 `recommendations[].code` 为 `clarify_continuation` 时，JSON summary 必须只列出 `resume.readiness.missing` 中已有的固定证据类别；CLI 与 Markdown 必须从同一列表生成中文文案。该绑定不新增 Report v2 字段，也不改变 readiness 提取、权重或阈值。

### FR-6: export

`export [file] -o <conversation.md>` 必须：

- 按 `parseJsonl` 返回顺序导出每条 `NormalizedMessage`。
- 不经过 tokenizer、safety、scorer、threshold、report 脱敏、筛选或截断。
- 记录 `trimctx.transcript.v1`、输入路径和 SHA-256、检测格式、可用 session ID、消息数及逐消息审计元数据。
- 使用动态长度 Markdown 围栏隔离正文中的 Markdown、HTML 和已有代码围栏。
- 明确产物默认未脱敏、分享前必须审查，并说明它不是 raw JSONL backup。
- 只接受 `.md` 输出，拒绝输入文件及其别名，保持输入句柄打开并原子写入。
- 省略 `[file]` 时只使用可信当前窗口绑定，不回退到 latest session。

### FR-7: analyze

当前行为：

- `analyze <file>` 默认输出短摘要。
- `analyze <file> --json` 输出完整 JSON。

### FR-8: compress

`compress <file> -o <output.jsonl>` 必须：

- 写入新文件。
- 不修改原文件。
- 不删除 protected。
- 不删除 keep。
- 不删除 compress_candidate。
- 只删除非 protected 的 remove_candidate。
- 拒绝把输出路径写成输入文件本身。
- 使用同目录原子替换；可恢复的写入失败不得破坏既有输出。
- 在读取后、提交前输入发生变化时拒绝提交旧快照生成的输出。

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
- 每条 `remove_candidate` 和 `compress_candidate` 都有非空 `reasons`。
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
- 每个成功 analyze/report 的 Report v2 `input.file` 必须与当前 batch 样本绝对路径精确匹配。
- 每个独立成功的 analyze/report 对必须具有完整 Report v2 语义证据；`phase0:review` 重算当前 report canonical SHA-256 后，`matched_analyze_report_semantics` 必须等于 `expected_analyze_report_pairs`。旧 v2 缺证据必须重跑，公开工件不得输出 digest、字段差异或正文。
- `phase0-results.json` 使用 `trimctx.phase0.results.v2`；每个样本记录合法 before/after SHA-256，`input_unchanged` 与摘要是否相等严格一致，`input_sha256_bound:true` 证明三条命令已启用首次摘要绑定，每个成功 report 和 compress 产物都记录精确字节 SHA-256。旧 v2 缺少绑定证据时必须保持 `review_required`。
- 人工 review 读取的 report ID、SHA-256、`input.source` 和 `input.file` 必须与 batch evidence 全部匹配；来源覆盖只统计这些实际成功 report。
- 人工 review 必须按 results 顺序精确重算 `aggregate.failed_samples`，并拒绝重复 sample、重复成功压缩产物 ID 或其他聚合矛盾。
- 每个成功 compress 对应的 `.trimmed.jsonl` ID 集合与 SHA-256 必须与 review 时实际读取的普通文件完全一致；工件必须能按同名 report 声明的 source adapter 重读，且规范化消息多重集必须与 report 排除 `remove_candidate` 后的保留集合一致。review 只公开结构/集合/哈希等聚合匹配数和固定 issue，不公开路径、ID、digest、fingerprint、parser 错误或正文；该门不证明 scorer 决策安全，也不替代人工审查。

## 10. 当前优先级

当前命令面、Report v2 和集成边界已完成本轮收敛；Phase 0 指标仍作为未来对外宣称自动压缩安全性的正式发布门槛。

1. 保持 `init`、`analyze`、`report`、`export`、`new-chat`、`compress` 六个公开命令及现有输出契约；`export` 是经批准的有限新增面。
2. 保持 `trimctx.report.v2`、Markdown 人工审查报告和原子写入行为稳定。
3. 保持 tool use/result 结构保护、protected 不删除和原始 transcript 只读。
4. 使用代表性 Claude Code / Codex 会话复核 assessment、findings、review queue 和 continuation readiness。
5. 补齐 Phase 0 人工审查指标和真实私有 OpenAI export 验证后，再提高安全承诺等级。
6. 保持 Windows packed-install、npm 包体和 fresh-install smoke 质量门。
7. 除已批准的 `export` 外不扩大产品面；不扩大自动删除范围，暂不新增 diagnostics 命令、Web UI、MCP 或后台自动化。

## 11. 文档关系

- 本文档定义“要做什么”。
- `docs/user/usage.md` 说明”怎么使用”。
- `docs/dev/roadmap.md` 说明”按什么阶段推进”。
- `docs/dev/execution-plan.md` 说明”怎么落地执行”。
- `docs/dev/status-and-next-steps.md` 记录”当前进度和下一步”。

