# trimctx 当前状态与下一步

## 文档分工

- `README.md`：开源入口和快速开始。
- `docs/requirements.md`：项目需求、边界和验收标准。
- `docs/usage.md`：用户使用说明。
- `docs/roadmap.md`：阶段路线和开源门槛。
- `docs/execution-plan.md`：执行任务、数据集和 Phase 0 验收。
- `PLAN.md`：长期愿景和最终体验。

## 当前已经完成

v0.1 Phase 0 核心 CLI 已经实现：

- `trimctx analyze <file>`
- `trimctx analyze <file> --json`
- `trimctx report <file> -o <report.json>`
- `trimctx compress <file> -o <output.jsonl>`
- `trimctx resume`（扫描 `~/.claude/projects/` 中最近修改的 Claude Code `.jsonl`）
- Claude Code JSONL parser
- OpenAI JSONL parser
- ApproxTokenizer
- safety rules
- scorer
- report JSON
- compressor
- 必需测试

验证命令：

```bash
npm test
npm run build
```

当前结果：

- `npm test` 通过
- `npm run build` 通过

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

### 1. Phase 0 多样本验证仍未完成

当前 CLI 输出体验已经进入 v0.2 形态：

- `analyze` 默认输出短摘要
- `report` 输出完整 JSON
- `analyze --json` 输出完整 JSON
- `resume` 可分析最近 Claude Code session

剩余重点是按 `docs/execution-plan.md` 补齐 5 个真实 Claude Code 长会话私有样本验证。

## 下一步执行顺序

### Step 1：补 Phase 0 多样本验证

按 `docs/execution-plan.md` 补齐 5 个真实 Claude Code 长会话的私有验证样本，并输出：

```text
reports/phase0/validation-summary.md
```

目标：

- 覆盖功能开发、Bug 调试、重构、文档规划、长工具调用任务
- 人工标注 protected / keep / compress / remove
- 验证 remove_candidate precision
- 确认 critical false deletion = 0

### Step 2：重新验证真实样本和压缩安全

用样本 2 跑：

```bash
npx tsx src/cli.ts analyze "C:\Users\kele\.claude\projects\E--xxyWork-heli-ml-museum\5c574dba-0f62-406b-980b-a098da258ddd.jsonl"
```

期望：

- 仍能解析
- protected 比例下降
- 出现一批低风险候选
- reasons 可解释
- `compress` 仍不修改原文件

### Step 3：收敛当前 CLI，不新增命令

只有当 CLI 输出和多样本验证可信后，才重新评估是否需要额外 session discovery / diagnostics 命令。当前阶段继续打磨：

- `trimctx analyze <file>`
- `trimctx analyze <file> --json`
- `trimctx report <file> -o <report.json>`
- `trimctx compress <file> -o <output.jsonl>`
- `trimctx resume`

安装器和 `/trimctx` 放到后续 Claude Code 集成阶段。

## 当前结论

项目现在已经不是“不能跑”的阶段，而是进入“让分析结果真正有用”的阶段。

当前最重要任务：

**补齐 Phase 0 多样本验证，确认当前 CLI 的安全性和可用性，再决定是否需要新增命令。**
