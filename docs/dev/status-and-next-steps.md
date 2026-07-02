# trimctx 当前状态与下一步

## 文档分工

- `README.md`：开源入口和快速开始。
- `docs/dev/requirements.md`：项目需求、边界和验收标准。
- `docs/user/usage.md`：用户使用说明。
- `docs/dev/roadmap.md`：阶段路线和开源门槛。
- `docs/dev/execution-plan.md`：执行任务、数据集和 Phase 0 验收。
- `docs/dev/iteration-plan.md`：团队评审后的当前迭代计划、优先级和质量门。

## 当前已经完成

### v0.1 核心 CLI

- `trimctx analyze <file>` / `--json`
- `trimctx report <file> -o <report.json>`
- `trimctx compress <file> -o <output.jsonl>`
- Claude Code / OpenAI / Codex-Hermes 三种 JSONL parser（自动检测格式）
- 近似 tokenizer（零外部依赖）
- 安全规则引擎（13 条 hard-protect 规则）
- 多维度 rot 评分器（6 维评分 + 重要性折扣）
- JSON report schema（含 score_diagnostics）
- 安全压缩器（原文件 hash 不变）

### v0.2 CLI 可用性与集成

- `trimctx init` — 从 npm 包安装 Claude Code 插件和 Codex skill
- `trimctx current` — 自动发现最新会话，支持 `--source auto|claude|codex`
- `trimctx new-chat` — 生成确定性 UID 交接包，默认输出 `.trimctx/handoffs/<uid>/`
- Claude Code 插件（`plugins/trimctx/`）：`/trimctx`、`/trimctx:analyze`、`/trimctx:compress`
- Codex skill（`codex/skills/trimctx/SKILL.md`）
- GitHub 安装脚本（`install.sh` / `install.ps1`）
- `report` 中的 `score_diagnostics`（max/p90/near_threshold/protected_high_rot/decision_ranges）

验证命令：

```bash
npm test
npm run build
```

当前结果：

- `npm test` 通过
- `npm run build` 通过

### Phase 0 自动验证进度

`reports/phase0/validation-summary.md` 已记录 5 个 Claude Code 私有样本的聚合验证结果：

- 总 messages：5,681
- 总 tokens：1,426,860
- 总 remove candidates：351
- 总 compress candidates：245
- 所有样本压缩前后原始文件 hash 均未变化

人工评审尚未完成（precision、protected recall、critical false deletion count 待确认）。真实私有 OpenAI 和 Codex/Hermes 样本验证仍待补充。

## 已修复的问题

真实 Claude Code JSONL 文件开头不一定是普通 `user/assistant` 消息，可能包含：

- `mode`
- `permission-mode`
- `file-history-snapshot`
- `attachment`
- `ai-title`
- `last-prompt`
- system meta event

已修复自动检测逻辑：现在会扫描前 25 条记录判断格式，而不是只看第一行。

## 真实样本验证

### 样本 1

路径：

```text
C:\Users\kele\.claude\projects\C--Users-kele\fffc50ff-b984-4dd8-8cd0-bcc6aa583b43.jsonl
```

结果：

- 11 条记录
- 能解析
- 因样本太短，最近 30 条消息规则导致全部 protected
- 不适合验证清理效果

### 样本 2

路径：

```text
C:\Users\kele\.claude\projects\E--xxyWork-heli-ml-museum\5c574dba-0f62-406b-980b-a098da258ddd.jsonl
```

调校前结果：

- 633 条记录
- 约 1.58MB
- 能解析
- 总 tokens：218,385
- protected：481
- keep：151
- compress_candidate：1
- remove_candidate：0

调校后结果：

- protected：338
- keep：224
- compress_candidate：30
- remove_candidate：41
- 预计节省：5,592 tokens
- 原始文件 hash 验证不变

结论：

parser 可用，scorer/safety 已经能在真实长会话里产出一批可解释的低风险候选。下一步重点转向 Phase 0 多样本验证。

## 已缓解的问题

### 1. protected 曾经过多

调校前，真实长会话中 633 条记录有 481 条 protected。

主要原因：

- `recent_message`：241 条
- `references_tool_result`：161 条
- `tool_result_referenced_later`：144 条
- `contains_file_path`：80 条

调校后：

- protected 降为 338
- `references_tool_result` 降为 17
- `tool_result_referenced_later` 降为 17
- 出现 41 条 `remove_candidate` 和 30 条 `compress_candidate`

### 2. tool_use / tool_result 保护策略已收窄

调校前逻辑是：

- tool_use 提到 tool id，则 protected
- tool_result 被引用，则 protected

这在安全上保守，但会导致大量旧工具调用无法成为候选。

应该改成：

- 最近工具结果保护
- 被最终结论引用的工具结果保护
- 旧的重复 Read/Grep/Glob 结果可成为压缩候选
- 旧 tool_use 调用本身通常不需要永久 protected

当前已实现：

- 旧 tool_use 不再因为自身 tool id 被自动 protected
- tool_result 只有被后续非工具自然语言消息引用时才 protected
- 真实样本中的 tool 引用保护数量明显下降

### 3. 元事件已经加入低价值评分

以下事件通常不应长期占用上下文：

- `file-history-snapshot`
- `ai-title`
- `mode`
- `permission-mode`
- 大块 `skill_listing`
- 大块 `mcp_instructions_delta`

当前已实现 `low_value_metadata` / `low_value_score`，真实样本首批候选主要来自 `file-history-snapshot`、`ai-title`、`last-prompt` 和大块 MCP instruction attachment。

## 当前主要问题

### 1. Phase 0 证据记录已扩展，但人工评审闭环仍未完成

当前 CLI 输出体验已经进入 v0.2 形态：

- `analyze` 默认输出短摘要
- `report` 输出完整 JSON
- `analyze --json` 输出完整 JSON
- `current --source claude` 可分析最近 Claude Code session
- `current --source codex` 可分析最近 Codex session
- `new-chat` 可生成 deterministic Markdown 交接材料

当前 `reports/phase0/validation-summary.md` 已记录 Claude Code 与 Codex/Hermes rollout 私有样本的聚合验证结果，但 Phase 0 还不能宣称完成：

- 真实私有 OpenAI JSONL export 仍未提供验证
- 删除候选 precision、protected recall、critical false deletion count 仍需要人工评审指标
- 零 `remove_candidate` 批次只能证明默认行为保守，不能证明删除候选 precision

## 下一步执行顺序

### Step 1：完成 Phase 0 人工评审指标

按 `docs/dev/manual-review-rubric.md` 对私有验证结果进行人工评审，并只把聚合指标写入：

```text
reports/phase0/validation-summary.md
```

目标：

- 记录 remove candidate precision
- 记录 protected recall
- 确认 critical false deletion = 0
- 标记 `questionable_remove`、`over_protected` 和 `missed_low_value_noise` 作为后续调参证据

### Step 2：补真实私有 OpenAI export 验证

在用户提供真实 OpenAI JSONL export 后，将其加入 Phase 0 私有验证批次。只发布聚合统计，不提交原始 transcript、私有 report 或 `phase0-results.json`。

期望：

- 能自动识别 OpenAI JSONL
- `analyze`、`report`、`compress` 都能跑通
- `compress` 不修改原文件
- 人工评审指标能覆盖 OpenAI 样本

### Step 3：收敛当前 CLI 信任信号

先维持默认保守行为，不调整 scorer/compress 行为。当前阶段继续打磨：

- `trimctx analyze <file>`
- `trimctx analyze <file> --json`
- `trimctx report <file> -o <report.json>`
- `trimctx compress <file> -o <output.jsonl>`
- `trimctx current`
- `trimctx current --source codex`
- `trimctx new-chat [file]`

### Step 4：冻结高风险扩展

Phase 0 人工指标闭环前，不推进 Web UI、MCP、hooks、自动压缩、LLM summarization 或更激进删除阈值。

### Step 5：准备发布前证据检查

在声称阶段完成前运行质量门，并检查文档不得宣称未验证能力已完成。

## 当前结论

项目现在已经不是“不能跑”的阶段，而是进入“验证信任信号是否足够”的阶段。

当前最重要任务：

**补齐 Phase 0 人工评审指标和真实私有 OpenAI export 验证，确认当前 CLI 的安全性和可用性，再决定是否调整 scorer/compress 或推进更高风险集成。**
