## Context

`docs/work` 包含三类输入：

- `context-rot-analyzer.tar.gz`：上下文腐烂评分算法原型包，包含 types、protectionRules、rotScorer、decisionEngine、entityExtractor、cliReporter 和 demo。
- `00_TrimContext项目分析总览.md`：对原型价值、缺口和迁移方向的分析。
- `trimctx-integration-guide.md`：基于真实 Claude Code JSONL 的解析和集成建议。
- `集成改造方案.md`：较早期的目录、类型、parser、tokenizer、reporter 和测试改造方案。

当前 trimctx 已经实现主干能力：

- `src/adapters/claude-code-jsonl.ts` / `openai-jsonl.ts`：JSONL parser。
- `src/core/analyzer.ts`：parse -> tokenize -> safety -> scorer 主流程。
- `src/core/safety.ts`：保护规则。
- `src/core/scorer.ts`：腐烂评分与 reasons。
- `src/core/reporter.ts`：JSON report 与 top reasons。
- `src/core/compressor.ts`：安全压缩副本。
- `src/core/tokenizer.ts`：近似 token 统计。
- CLI 已有 analyze/report/compress，并正在推进 v0.2 输出体验。

因此本 change 不应直接迁移原型代码，而应产出一份面向当前代码状态的评估：哪些已经覆盖，哪些当前没有但值得集成，哪些暂缓，哪些不建议集成。

## Goals / Non-Goals

**Goals:**

- 识别 `docs/work` 中真正有价值的核心功能点。
- 对照当前 `src/` 和项目路线图，判断哪些能力已经覆盖。
- 找出当前缺失但可能值得集成的点，并给出必要性等级。
- 给出后续集成优先级、风险和验证方式。
- 产出一份轻量评估文档，作为后续实现变更的依据。

**Non-Goals:**

- 不把 `context-rot-analyzer.tar.gz` 直接解压或迁入主工程。
- 不修改 parser、safety、scorer、reporter、compressor 或 CLI。
- 不改变 v0.2 主线。
- 不引入新依赖。
- 不提交真实样本或大型临时产物。

## Decisions

### Decision 1: 输出评估文档，不直接改代码

本 change 的产物应是评估结论文档，建议放在：

```text
docs/work/integration-value-assessment.md
```

理由：

- 用户问题本质是“是否有价值、是否有必要集成”。
- 当前实现已经覆盖大量原型功能，直接实现容易重复。
- 文档可以作为后续 OpenSpec 变更的输入，减少范围膨胀。

### Decision 2: 用四类状态标注功能点

每个功能点按以下状态归类：

| 状态 | 含义 |
|---|---|
| 已覆盖 | 当前项目已有等价或更合适实现，不需要迁移 |
| 当前缺失但有价值 | 当前没有，且能提升 v0.2 或后续质量 |
| 当前缺失但暂缓 | 有价值，但不适合当前主线 |
| 不建议集成 | 与当前目标冲突、重复、风险高或收益低 |

这样能避免把“历史实现方案”误当成“现在必须做的功能”。

### Decision 3: 初步缺口判断

基于已读取材料和当前源码，初步分类如下，后续文档需要补充依据。

**已覆盖：**

- Claude Code JSONL parser：当前 `parseJsonl` 会扫描前 25 条记录识别 Claude Code，并保留 metadata 行为。
- OpenAI JSONL parser：已存在。
- ApproxTokenizer：已存在基础实现。
- safety rules：已覆盖 system/developer、recent、代码块、错误栈、路径、命令、diff、测试失败、记忆指令、用户决策、架构/API/配置和被引用 tool_result。
- scorer 维度：已覆盖 superseded、low_reference、age、redundancy、orphan_tool、low_value。
- report schema、top reasons、compress 安全副本：已存在或正在当前主线中推进。

**当前缺失但有价值：**

- 实体抽取 entity extraction：原型有独立 `entityExtractor` 概念，当前只有 scorer 内部关键词提取。价值在于更稳定地识别文件、函数、类、错误、变量和决策实体，支撑引用判断和报告审计。
- 关系图谱 relations：原型提到 `tool_pair`、`entity_ref`、`supersedes`、`causal`。当前报告没有顶层 relations。价值在于解释为什么某条 tool_result 被保护或可删除，但实现成本较高。
- 配置化阈值：当前 recent window、score 权重和阈值基本写死。配置化有助于真实样本调参，但过早开放配置会增加支持成本。
- 更细 token 估算：当前 tokenizer 简洁可靠，但未区分代码块、中文、英文、Read tool_result 等。增强可改善 saving 估算准确性。
- compact/away_summary 信号：docs/work 提到 `away_summary` 可标记会话已被 Claude 压缩过。当前 metadata 会被 flatten，但没有作为报告顶层 warning 或 summary 信号。

**当前缺失但暂缓：**

- 顶层全局 relations 报告：有审计价值，但应在 v0.2 CLI 可用性和 Phase 0 验证后再做。
- 可配置规则系统：有价值，但应先稳定默认行为，再暴露配置。
- compress_candidate 摘要化：当前产品原则是保守，v0.1/v0.2 不应生成摘要替换原文。

**不建议集成：**

- 直接迁移原型 parser：当前 parser 已支持真实 Claude Code 边界，原型 parser 反而更粗糙。
- 直接迁移原型 types/report schema：当前 schema 已按 trimctx 需求命名并支持 rawLine/raw/sourceLine/reasons。
- 直接迁移 cliReporter：当前 CLI 正在按 v0.2 human summary 设计推进，不应回退到原型输出。

## Approach

实现阶段只创建评估文档：

1. 读取 `docs/work` 所有文档，并列出材料与功能点来源。
2. 对照当前源码模块和项目文档，形成覆盖矩阵。
3. 对每个缺失功能写明：
   - 它解决什么问题。
   - 当前没有它的影响。
   - 是否符合 v0.2 主线。
   - 集成必要性等级。
   - 推荐目标阶段。
   - 验证方式。
4. 明确不建议直接迁移原型包。
5. 给出后续 OpenSpec 变更建议，例如：
   - `add-entity-extraction`
   - `add-compact-signal-reporting`
   - `make-scoring-configurable`

## Risks

- **重复实现风险**：docs/work 中的旧方案和当前代码重叠很多。缓解方式：先做覆盖矩阵。
- **范围膨胀风险**：entity extraction、relations、配置化都可能变成大改造。缓解方式：只输出评估，不实现。
- **偏离 v0.2 主线风险**：当前最重要仍是 analyze 输出体验和 Phase 0 验证。缓解方式：把集成建议分阶段。
- **压缩包内容误用风险**：直接解压迁入会带来旧类型、旧 parser 和旧 reporter 冲突。缓解方式：压缩包只读参考。

## Verification

- 检查评估文档是否覆盖 `docs/work` 下所有材料。
- 检查每个核心功能点是否有状态分类和依据。
- 检查是否明确列出当前没有但有价值的功能点。
- 检查是否没有修改 `src/`。
- 运行 `openspec.cmd status --change "evaluate-work-docs-integration" --json` 确认 artifacts 状态。

## Data Model

本 change 不引入新的运行时数据模型，也不修改 report schema。评估文档中可以使用表格表达能力矩阵，但不需要 `data-model.md`。
