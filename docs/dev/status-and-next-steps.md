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
- 不直接完整合并该分支：以精确 SHA 重演时，`src/cli.ts`、`src/commands/new-chat.ts`、`src/core/compressor.ts`、`src/platform/files.ts` 存在核心语义冲突，且旧分支仍基于 `0.2.9`。
- 后续发布以 `main` 为唯一候选；除非明确开展历史代码研究，否则不要从该分支继续提交或发布。

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
- `trimctx current` — 严格分析 hooks 绑定的当前窗口；本地发现使用 `analyze --select/--latest`
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

### 1. 发布测试存在 Windows 路径假设

packed-install smoke 曾把全局包目录固定为 Unix 的 `prefix/lib/node_modules`，导致 Windows 上误报客户端资产缺失。测试需要按平台解析 npm 全局目录。

### 2. CLI 入口职责过多

`src/cli.ts` 同时承担命令注册、参数解析、handoff package、资产安装、hook 配置和文件安全逻辑。下一步采用兼容 facade 和小模块渐进迁移，不改变命令契约。

### 3. 集成副作用文档不一致

SessionStart hook 通过 `CLAUDE_ENV_FILE` 写当前会话绑定；Stop hook 可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块。README、usage、roadmap 和 iteration plan 必须统一披露这一边界。

## 下一步执行顺序

### Step 1：恢复跨平台发布质量门

- 修复 Windows packed-install 路径。
- 保持 tarball 资产清单和 fresh install smoke 覆盖。
- 运行 `npm test`、`npm run build`、`npm pack --dry-run --json`。

### Step 2：抽取低风险共享边界

- 文件同路径保护与存在性检查。
- CLI 分析参数解析。
- parser -> analyzer -> report pipeline。
- Claude/Codex session discovery。

### Step 3：拆分 CLI 命令注册

- 核心分析命令。
- `new-chat` / `handoff`。
- `init` / `hook` / `install-hooks`。
- `src/cli.ts` 只保留程序入口、版本读取和统一错误出口。

### Step 4：统一产品文档

- 已有 packaged integrations 标记为已实现但实验性。
- `current` 不再承载压缩；压缩继续要求显式 `trimctx compress <file> -o <output>`。
- 明确 hooks 写入范围，继续保证原始 JSONL 只读。

### Step 5：冻结高风险扩展

暂不推进 Web UI、MCP、后台监控、自动压缩、LLM summarization 或更激进删除阈值。

## 当前结论

项目已进入“保持现有可用行为，同时降低结构和集成维护风险”的阶段。

当前最重要任务：

**恢复跨平台质量门，统一集成副作用文档，并在行为测试保护下完成 CLI、pipeline 和 session discovery 的渐进拆分。**
