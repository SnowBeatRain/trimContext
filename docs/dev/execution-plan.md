# trimctx Execution Plan

本文档是 trimctx 的可执行项目任务书。本文档定义**执行任务、数据集要求和逐阶段验收标准**。
团队评审后的迭代优先级、质量门和冻结项见 [`docs/dev/iteration-plan.md`](iteration-plan.md)。
项目需求和边界见 `docs/dev/requirements.md`，使用说明见 `docs/user/usage.md`，版本路线见 `docs/dev/roadmap.md`。

## 0. 一句话定义

trimctx 是一个本地 CLI 工具，用来读取 Claude Code / OpenAI / Codex 等 AI Agent 长对话记录，识别过时、重复、未引用、低价值的上下文内容，输出可审计报告，并生成安全的压缩副本。

trimctx 不是聊天工具，不是新的 Agent 框架，不是 Web 平台，不是默认自动删除器，也不是 LLM 评测平台。

## 1. v0.1 唯一目标

让用户可以对一个真实 Claude Code 长对话文件运行：

```bash
trimctx analyze ~/.claude/projects/.../session.jsonl
```

并得到：

- 这个对话一共有多少 messages。
- 一共有多少 tokens。
- 哪些 messages 可能已经腐烂。
- 为什么判定它腐烂。
- 哪些内容绝不能删。
- 理论可节省多少 tokens。

然后用户可以运行：

```bash
trimctx compress ~/.claude/projects/.../session.jsonl -o session.trimmed.jsonl
```

得到一个新文件，原文件不被修改。

## 2. v0.1 不追求什么

- 不追求智能总结。
- 不追求实时监控。
- 不追求完美识别。
- 不追求所有 Agent 格式都支持。
- 不追求 Web UI。
- 不追求商业化。
- 不默认调用 LLM。

v0.1 只证明一件事：规则检测能不能在真实长对话里稳定找出一批可清理内容，同时不误删关键上下文。

## 3. 产品边界

| 能力 | v0.1 是否做 | 说明 |
| --- | --- | --- |
| 读取 Claude Code JSONL | 做 | 第一优先级 |
| 读取 OpenAI JSONL | 做基础版 | 作为通用格式 |
| 读取 Codex/Hermes rollout JSONL | 做 | 解包 `payload` 后复用 OpenAI 归一化逻辑 |
| 读取纯文本对话 | 暂不做 | 可作为后续兜底 parser |
| 分析 token 数 | 做 | 先近似，后续可接 tiktoken |
| 输出 JSON 报告 | 做 | `report` 命令保留完整机器可读数据 |
| 输出完整规范化 Markdown transcript | 做 | `export` 独立导出，不改变脱敏健康报告 |
| 输出终端摘要 | 做 | `analyze` 默认应该短摘要 |
| 输出压缩副本 | 做 | 永远不改原文件 |
| 每条建议给 reason | 做 | 必须可解释 |
| 保护关键消息 | 做 | 必须 |
| 自动删除原始文件 | 不做 | 永远不做 |
| 默认调用 LLM | 不做 | v0.1 禁止 |
| Web UI | 不做 | 后续再评估 |
| MCP Server | 不做 | 后续多平台阶段再评估 |
| REST API | 不做 | 不属于当前主线 |
| 企业版 | 不做 | 等开源版稳定后再说 |

## 4. 技术边界

| 模块 | 选择 |
| --- | --- |
| 语言 | TypeScript |
| Runtime | Node.js 20+ |
| CLI | commander |
| 测试 | vitest |
| Tokenizer | 先用 `ApproxTokenizer`，保留后续替换空间 |
| 输出格式 | JSON + Markdown + terminal summary |
| 存储 | 文件系统 |
| 数据库 | 不做 |
| Python | 不做主线 |
| LLM | 不做主线 |
| embedding | 不做主线 |

## 5. 数据边界

v0.1 只处理本地用户自己拥有的对话文件。

允许：

```text
~/.claude/projects/**/*.jsonl
./tests/fixtures/*.jsonl
./datasets/private/raw/*.jsonl
```

不做：

```text
读取别人账号
读取 Claude 服务器
读取浏览器页面
绕过权限抓取终端内容
上传用户数据到云端
```

## 6. 实时能力边界

实时能力不进 v0.1。

Claude Code hooks 会在生命周期事件触发时把 JSON 上下文传给 hook handler；command hook 的输入从 stdin 进入，事件包括 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PreCompact`、`PostCompact` 等。hook 输入里包含 `transcript_path`，这使 trimctx 后续可以定位当前 session 的 JSONL 文件。

Claude Code status line 也会把 JSON session data 通过 stdin 传给脚本，并包含 `transcript_path`，适合后续做轻量 context health 展示。

因此实时能力应该放到 Claude Code 集成阶段：

```bash
trimctx install-hooks
trimctx hook
trimctx statusline
```

参考：

- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/statusline

## 7. 阶段执行路线

### v0.1: 离线分析版

目标：能分析一个本地对话文件。

命令：

```bash
trimctx analyze <file>
trimctx analyze <file> --json
trimctx report <file> -o <report.json>
trimctx compress <file> -o <output.jsonl>
```

交付物：

- CLI 可运行。
- Claude Code JSONL parser。
- OpenAI JSONL parser。
- Codex/Hermes rollout JSONL parser。
- token 统计。
- `rot_score` 计算。
- protected 保护规则。
- `report.json`。
- compressed JSONL 副本。
- 基础测试。

### v0.2: Claude Code 友好 CLI

目标：用户可以先用清晰短摘要和完整报告理解当前会话，不需要阅读巨大的原始 JSON。

当前主线命令：

```bash
trimctx init
trimctx analyze <file>
trimctx analyze <file> --json
trimctx report <file> -o report.json
trimctx export [file] -o conversation.md
trimctx new-chat [file]
trimctx compress <file> -o output.jsonl
```

交付物：

- `analyze` 默认输出短摘要。
- `analyze --json` 输出完整 JSON。
- `report` 输出完整机器可读报告。
- `export` 输出 parser 识别的全部规范化消息，默认未脱敏，不是 raw JSONL backup。
- `compress` 生成安全压缩副本且拒绝覆盖输入文件。
- 无文件 `analyze` 和 `export` 只使用 hooks 绑定的当前窗口；`analyze --latest --source claude` 显式分析最近 Claude Code session。
- report top reasons 和 warnings。
- JSONL 解析错误包含可定位的文件和行号。
- 阈值参数仅作为高级验证/调参选项，不作为普通用户主路径。

### v0.3: Claude Code Hooks 和 Status Line

目标：正在对话时可用。

候选命令：

```bash
trimctx install-hooks
trimctx hook
trimctx statusline
trimctx watch --latest
```

交付物：

- 写入或修复 Claude Code settings。
- `UserPromptSubmit` hook。
- `Stop` hook。
- `PostCompact` hook。
- status line 输出。
- 当前会话健康状态缓存。

约束：

- hook 必须很快，不能阻塞模型处理。
- hook 默认只做轻量记录或异步触发。
- 不自动压缩当前会话。

### v0.4: 开源发布准备

目标：仓库可以公开，npm 包可以发布。

交付物：

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- CI workflow。
- npm package metadata。
- sanitized fixtures。
- release checklist。

### v0.5: 增强检测引擎

目标：在核心 CLI 稳定后，再考虑更重的语义检测支线。

候选能力：

- Python SDK。
- semantic detector。
- nonsense score。
- DeepEval / RAGAS 等评测工具调研。
- Docker。
- Dashboard。

这些能力不应该进入 v0.1/v0.2 主线。

## 8. 核心用户流程

用户拿到一个 Claude Code 会话文件：

```bash
~/.claude/projects/my-project/session-001.jsonl
```

运行：

```bash
trimctx analyze ~/.claude/projects/my-project/session-001.jsonl
```

终端输出应该是短摘要：

```text
trimctx analysis

messages: 428
tokens: 182,430
protected: 96
remove candidates: 73
compress candidates: 41
estimated saving: 31,840 tokens (17.45%)

top reasons:
- orphan_tool_result: 28
- superseded_by_later_instruction: 17
- low_reference_in_later_context: 55

next:
- trimctx report <file> -o report.json
- trimctx compress <file> -o output.jsonl
```

用户检查完整报告：

```bash
trimctx report ~/.claude/projects/my-project/session-001.jsonl -o reports/session-001.report.json
```

最后生成压缩副本：

```bash
trimctx compress ~/.claude/projects/my-project/session-001.jsonl -o session-001.trimmed.jsonl
```

原文件永远不修改。

## 9. 数据集收集方案

Phase 0 至少需要 5 个真实 Claude Code 长对话，用于验证规则稳定性。

| 样本 | 类型 | 最低要求 |
| --- | --- | --- |
| session-001 | 功能开发 | 100+ messages |
| session-002 | Bug 调试 | 100+ messages |
| session-003 | 重构任务 | 150+ messages |
| session-004 | 文档/规划 | 80+ messages |
| session-005 | 长工具调用任务 | 150+ messages，包含大量 tool_use/tool_result |

最低总量：

- 5 个 session。
- 总 messages >= 600。
- 总 tokens >= 200k。
- 至少 1 个 session 含大量 tool_result。
- 至少 1 个 session 发生过 compact。
- 至少 1 个 session 有用户后续纠正前面要求。

建议目录：

```text
datasets/
  private/
    raw/
    sanitized/
    labels/
  public/
    examples/
```

`datasets/private/` 必须加入 ignore，不进入开源仓库。

## 10. 人工标注格式

当前 Phase 0 人工标注以 `docs/dev/phase0/manual-label-guide.md` 为准。每个被审查的 report message 写一行 JSONL，文件必须放在私有且 gitignored 的 labels 目录中，例如：

```text
datasets/private/phase0-labels/session-001.labels.jsonl
```

最小格式：

```jsonl
{"sample_id":"session-001","message_id":"msg-41","decision":"remove_candidate","label":"safe_remove","review_note":"obsolete duplicated tool output"}
{"sample_id":"session-001","message_id":"msg-82","decision":"compress_candidate","label":"needs_summary","review_note":"large but useful debugging context"}
{"sample_id":"session-001","message_id":"msg-140","decision":"keep_protected","label":"protected_keep","review_note":"current architecture decision"}
```

标签定义：

| 标签 | 适用范围 | 含义 |
| --- | --- | --- |
| `safe_remove` | `remove_candidate` | 候选可安全删除。 |
| `questionable_remove` | `remove_candidate` | 可能可删，但证据不足，不计为安全删除。 |
| `critical_keep` | `remove_candidate` | 候选实际必须保留，计为 critical false deletion。 |
| `protected_keep` | protected 消息 | 保护正确。 |
| `over_protected` | protected 消息 | 可能过度保护，只作为调参证据。 |
| `missed_low_value_noise` | 未 protected 的非删除消息 | 低价值噪声未被充分暴露。 |
| `needs_summary` | 非删除消息 | 值得保留但未来可能需要总结，非锁定证据。 |
| `unclear` | 任意被审查消息 | 仅凭 report 无法判断，非锁定证据。 |

`critical_false_delete` 仅作为 `critical_keep` 的旧别名兼容；新标签文件应使用 `critical_keep`。

第一版宁可保守。

## 11. 核心算法定义

所有 parser 最终都转成 `NormalizedMessage`。当前实现已经包含：

- `id`
- `role`
- `content`
- `source`
- `sourceLine`
- `rawLine`
- `raw`
- `timestamp`
- `sessionId`
- `parentId`
- `tool`
- `tokens`
- `protected`
- `scores`
- `rot_score`
- `decision`
- `reasons`

当前评分结构：

```ts
export interface RotScores {
  superseded_score: number;
  low_reference_score: number;
  age_score: number;
  redundancy_score: number;
  orphan_tool_score: number;
  low_value_score: number;
  rot_score: number;
}
```

当前 decision 规则：

```ts
if (protected) {
  decision = "keep_protected";
} else if (rot_score >= 0.8) {
  decision = "remove_candidate";
} else if (rot_score >= 0.6) {
  decision = "compress_candidate";
} else {
  decision = "keep";
}
```

## 12. 保护规则

保护规则必须先于 `rot_score` 执行。

永远保护：

- system / developer。
- 最近 30 条消息。
- 包含代码块。
- 包含错误栈。
- 包含文件路径。
- 包含 shell 命令。
- 包含 git diff。
- 包含测试失败原因。
- 包含记忆类指令。
- 包含用户明确决策。
- 包含 API / schema / 架构 / 配置决策。
- 被后续自然语言总结引用的关键 tool_result。

可删除候选：

- 未被引用的旧 tool_result。
- 旧 tool_use 调用本身。
- 重复的 assistant 解释。
- 被用户后续纠正覆盖的旧方案。
- 长时间没有再出现关键词的旧上下文。
- 明显低价值元事件。
- 同一内容多次展开解释。

## 13. Parser 要求

Claude Code JSONL parser：

- 逐行读取。
- 每行 JSON parse。
- 识别 role。
- 识别 content。
- 识别 tool_use。
- 识别 tool_result。
- 识别 timestamp。
- 识别 session id。
- 保留 raw line。
- 支持文件开头出现 metadata event。

OpenAI JSONL parser：

- 支持 `{"messages":[...]}`。
- 支持单条 `{ "role": "...", "content": "..." }`。
- v0.1 只处理第一层 messages。

Plain text parser：

- 暂不进入当前主线。

## 14. 报告格式要求

`report.json` 必须包含：

- `schema_version`
- `input`
- `summary`
- `messages`
- `remove_candidates`
- `warnings`

`summary` 至少包含：

- `total_messages`
- `total_tokens`
- `remove_candidates`
- `compress_candidates`
- `protected_messages`
- `estimated_saving_tokens`
- `estimated_saving_ratio`

每条 message 至少包含：

- `id`
- `role`
- `tokens`
- `protected`
- `rot_score`
- `scores`
- `decision`
- `reasons`

## 15. 压缩策略

v0.1 `compress` 只做安全压缩：

| decision | 行为 |
| --- | --- |
| `keep_protected` | 保留 |
| `keep` | 保留 |
| `compress_candidate` | 先保留 |
| `remove_candidate` | 删除 |

不允许：

- 不改原文件。
- 不覆盖输入文件。
- 不删除 protected。
- 不删除 unknown。
- 不删除最近 30 条消息。
- 不自动总结。
- 不调用 LLM。

如果用户没传 `-o`，直接报错。

## 16. 验收标准

Phase 0 验收：

- 成功解析 5 个真实 Claude Code JSONL。
- 每个 session 都能输出 report JSON。
- 每条 message 都有 tokens。
- 每条 remove_candidate 都有 reasons。
- 原始文件没有被修改。
- remove_candidate precision >= 70%。
- critical false deletion = 0。
- protected recall = 100%。
- parser success rate >= 95%。

v0.1 命令验收：

```bash
trimctx analyze datasets/private/raw/session-001.jsonl
trimctx report datasets/private/raw/session-001.jsonl -o reports/session-001.report.json
trimctx compress datasets/private/raw/session-001.jsonl -o datasets/private/raw/session-001.trimmed.jsonl
npm test
npm run build
```

安全验收：

- system/developer 消息没有被删除。
- 最近 30 条消息没有被删除。
- protected 消息没有被删除。
- compress 输出为新文件。
- 输入文件 hash 不变。

## 17. 当前开发任务拆解

### Task 1: CLI 摘要输出

目标：让 `trimctx analyze <file>` 默认输出短摘要。

文件：

- `src/cli.ts`
- `src/core/reporter.ts`
- `tests/`

验收：

- `trimctx analyze <file>` 输出人类可读摘要。
- `trimctx analyze <file> --json` 输出完整 JSON。
- `report` 仍输出完整 JSON 文件。

### Task 2: Report Top Reasons

目标：让报告 summary 或 helper 能展示 top reasons。

文件：

- `src/core/reporter.ts`
- `src/types/report.ts`
- `tests/`

验收：

- 大文件分析时能看到主要保护/候选原因。
- 测试覆盖 reason 计数。

### Task 3: Current CLI Stability

目标：稳定当前六命令公开面；除经批准的 `export` 外不新增额外 CLI surface。

当前命令：

```bash
trimctx init
trimctx analyze <file>
trimctx analyze <file> --json
trimctx report <file> -o report.json
trimctx export [file] -o conversation.md
trimctx new-chat [file]
trimctx compress <file> -o output.jsonl
```

验收：

- 默认 `analyze` 输出短摘要，`--json` 输出完整报告。
- `report` 与 `analyze --json` 的 JSON 语义一致。
- `export` 完整保留 parser 消息顺序和正文，原文件 hash 不变，输出只接受 `.md`。
- `compress` 拒绝覆盖输入文件，且原文件 hash 不变。
- JSONL 解析错误包含可定位的文件和行号。
- 阈值参数错误使用用户能理解的 CLI flag 名称。

### Task 4: Phase 0 Safety Calibration

目标：用真实样本判断 safety/scorer 是否过宽或过窄。

验收：

- 统计每个样本的 protected / remove_candidate / compress_candidate 数量和比例。
- 记录 top reasons，避免结果被单一保护原因淹没。
- 人工抽查 remove_candidate，确认 critical false deletion = 0。
- 基于验证结果提出 safety/scorer 候选调整，先人工复核，不直接修改默认阈值或删除行为。
- 不提交真实样本、真实报告或压缩输出。

### Task 5: Phase 0 Validation Report

目标：沉淀真实样本验证结果。

文件：

```text
reports/phase0/validation-summary.md
```

验收：

- 记录 5 个样本概况。
- 记录每个样本 messages/tokens。
- 记录人工标注数量。
- 记录工具预测数量。
- 记录 precision。
- 记录误删情况。
- 记录下一步规则调整。

## 18. 最终执行顺序

不要同时开很多方向。按这个顺序走：

本轮结构重构不以样本数量为阻塞；若未来要宣称压缩可免人工审查，仍按 Phase 0 的正式安全门执行。

1. 修复 Windows packed-install 路径并恢复发布质量门。
2. 抽取文件安全和 CLI 分析参数解析。
3. 拆分 analysis pipeline 与 session discovery，并保留兼容 facade。
4. 拆分核心分析、new-chat 和客户端集成命令注册。
5. 统一 hooks 写入范围、严格 `current` 与显式会话选择的文档说明。
6. 保持 safety/scorer 默认权重、阈值和删除行为不变。
7. 质量门稳定后再决定是否新增 diagnostics、后台监控、Web UI 或 MCP。

## 19. 最关键判断

第一版必须守住四个原则：

```text
1. 先离线，后实时
2. 先报告，后压缩
3. 先规则，后语义
4. 先安全，后激进
```

v0.1 的成功不是删得最多，而是删得有理由、用户看得懂、不会误删关键内容。
