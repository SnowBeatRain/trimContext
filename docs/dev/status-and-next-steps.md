# trimctx 当前状态与下一步

## 文档分工

- `README.md`：开源入口和快速开始。
- `docs/dev/requirements.md`：项目需求、边界和验收标准。
- `docs/user/usage.md`：用户使用说明。
- `docs/dev/roadmap.md`：阶段路线和开源门槛。
- `docs/dev/execution-plan.md`：执行任务、数据集和 Phase 0 验收。
- `docs/dev/iteration-plan.md`：团队评审后的当前迭代计划、优先级和质量门。

## 分支整理状态（2026-07-18）

- `refactor/full-command-optimization` 保留在远端作为历史参考，不删除、不继续作为发布分支开发。
- 该分支已被 `main` 上的选择性整合方案取代：报告摘要、Codex tool item 归一化、ROT 指标计算三个低耦合抽取已进入主线；Hook dry-run 防泄漏修复已按当前 `0.2.10` 架构重写并进入主线。
- 相对整合前发布基线 `origin/main@80aeae5`，该分支的独有提交计数为 `2 / 12`，精确合并重演在 `src/cli.ts`、`src/commands/new-chat.ts`、`src/core/compressor.ts`、`src/platform/files.ts` 产生 4 个核心语义冲突。相对已完成选择性整合的当前 `main@0598895`，计数为 `7 / 12`，并因两边都调整 Hook 回归覆盖而新增 `tests/hook.test.ts` 冲突。
- 这些冲突涉及命令架构、当前会话、压缩安全、文件写边界和 Hook 回归契约，且旧分支仍基于 `0.2.9`，因此不采用完整合并或简单的 `ours` / `theirs` 消解。
- 后续发布以 `main` 为唯一候选；除非明确开展历史代码研究，否则不要从该分支继续提交或发布。

## 当前已经完成

### v0.1 核心 CLI

- `trimctx analyze <file>` / `--json`
- `trimctx report <file> -o report.md|report.json`
- `trimctx compress <file> -o <output.jsonl>`
- Claude Code / OpenAI / Codex-Hermes 三种 JSONL parser（自动检测格式）
- 近似 tokenizer（零外部依赖）
- 安全规则引擎（13 条 hard-protect 规则）
- 多维度 rot 评分器（6 维评分 + 重要性折扣）
- `trimctx.report.v2` schema（含 assessment、findings、review_queue 和 recommendations）
- 安全压缩器（原文件 hash 不变）

### v0.2 CLI 可用性与集成

- `trimctx init` — 从 npm 包安装 Claude Code 插件和 Codex skill
- `trimctx` / 不带文件的 `analyze` — 只分析 hooks 绑定的当前窗口；本地发现使用 `analyze --select/--latest`
- `trimctx new-chat` — 生成确定性 UID 交接包，默认输出 `.trimctx/handoffs/<uid>/`
- `trimctx export [file] -o conversation.md` — 导出 parser 识别的全部规范化消息，不评分、不脱敏且保持原 JSONL 只读
- Claude Code 插件（`plugins/trimctx/`）：`/trimctx`、`/trimctx:analyze`、`/trimctx:export`、`/trimctx:new-chat`、`/trimctx:compress`
- Codex skill（`codex/skills/trimctx/SKILL.md`）
- GitHub 安装脚本（`install.sh` / `install.ps1`）
- Markdown 会话健康报告，以及与 `analyze --json` 一致的 v2 JSON 报告

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

项目负责人已经确认现有功能在真实工作流中可行；后续私有验证作为回归记录，不再作为继续 CLI 稳定化和结构重构的前置条件。这不等同于宣称 `phase0_trust` 已锁定；未来若对外承诺无需人工审查的压缩安全性，仍需满足正式 Phase 0 发布门槛。

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

### 1. Phase 0 信任门仍未锁定

当前工作流和保守压缩策略已经可用于本地审查，但这不等同于可以对外承诺“无需人工复核的压缩安全”。正式承诺仍需要多样本人工审查指标和真实私有 OpenAI export 验证。

### 2. Report v2 需要代表性样本复核

`trimctx.report.v2` 已提供结构化 evidence、独立 assessment、findings、review queue 和 candidate groups。下一步应检查这些结果是否准确、可解释、可操作，优先修正文案和误报，不扩大自动删除范围。

### 3. 集成边界需要持续保持明确

SessionStart hook 通过 `CLAUDE_ENV_FILE` 写当前会话绑定；Stop hook 可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块。原始 transcript 始终只读，绑定式分析与显式压缩继续分离。

## 下一步执行顺序

### Step 1：复核 Report v2 质量

- 使用代表性 Claude Code / Codex 会话检查健康结论、findings 和 review queue。
- 记录误报、漏报和 continuation readiness 缺口。
- 只在证据充分时调整规则或展示文案。

### Step 2：补齐 Phase 0 发布证据

- 完成多样本人工审查指标。
- 补充真实私有 OpenAI export 验证。
- 在门槛满足前继续保留人工审查提示。

### Step 3：保持发布与集成质量门

- 保持 Windows packed-install、tarball 资产清单和 fresh-install smoke 覆盖。
- 保持 `init`、`analyze`、`report`、`export`、`new-chat`、`compress` 六个公开命令、内部 hook executor 和原始 transcript 只读契约。
- 发布前运行测试、构建和 package contents 检查。

### Step 4：冻结高风险扩展

暂不推进 Web UI、MCP、后台监控、自动压缩、LLM summarization 或更激进删除阈值。

## 当前结论

项目已完成本轮命令面收敛、evidence-based Report v2、文件写入保护和集成说明更新；完整规范化 `export` 命令是经批准的有限例外，不改变评分或压缩边界。项目继续处于“复核报告质量并积累正式信任证据”的阶段。

当前最重要任务：

**用代表性样本审查 Report v2，补齐 Phase 0 证据，同时保持现有命令和安全边界稳定。**
