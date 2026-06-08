# docs/work 功能价值与集成必要性评估

## 1. 结论

`docs/work` 下的材料有参考价值，但不应直接作为代码迁移方案执行。

当前 trimctx 已经实现了 `context-rot-analyzer` 原型中最重要的产品主干：JSONL parser、token 估算、safety rules、scorer、report、compress 和 CLI。继续集成时，重点不应是“把原型包搬进来”，而应是提取当前项目尚未具备、且能提升审计质量或真实样本判断力的增量能力。

建议优先级：

1. **必须集成**：`compact/away_summary` 信号报告、真实样本洞察整理。
2. **可选集成**：实体抽取、token 估算增强、报告维度增强。
3. **暂缓集成**：关系图谱、配置化阈值。
4. **不建议集成**：直接迁移原型 parser、report schema、cliReporter、compress_candidate 摘要化。

## 2. 输入材料盘点

| 材料 | 类型 | 核心内容 | 当前用途 |
|---|---|---|---|
| `00_TrimContext项目分析总览.md` | 原型分析总览 | 说明 `context-rot-analyzer` 是算法原型，不是完整产品；列出原型已有模块和缺口 | 用于判断原型哪些能力仍有增量价值 |
| `trimctx-integration-guide.md` | 真实样本集成指南 | 总结 Claude Code JSONL 行类型、tool_result 结构、流式 assistant 去重、token 字段、away_summary 信号 | 用于校验 parser 边界和真实样本洞察 |
| `集成改造方案.md` | 历史开发方案 | 给出早期目录结构、类型、parser、tokenizer、safety、compressor、CLI、测试模板 | 多数内容已被当前项目覆盖；仅作为对照 |
| `context-rot-analyzer.tar.gz` | 原型源码包 | 包含 `entityExtractor`、`rotScorer`、`decisionEngine`、`protectionRules`、`cliReporter` 等 | 只读参考，不直接迁移 |

## 3. 当前已覆盖能力

| 能力 | 当前实现 | 判断 |
|---|---|---|
| Claude Code JSONL parser | `src/adapters/claude-code-jsonl.ts`、`src/core/analyzer.ts` | 已覆盖。当前实现还会扫描前 25 条记录识别格式，比只看第一行更适合真实文件。 |
| OpenAI JSONL parser | `src/adapters/openai-jsonl.ts` | 已覆盖。 |
| NormalizedMessage 基础结构 | `src/types/message.ts` | 已覆盖，并已包含 `developer`、`unknown`、`rawLine`、`raw`、`sourceLine` 等原型没有的字段。 |
| token 估算 | `src/core/tokenizer.ts` | 已覆盖基础能力，但还可增强估算精度。 |
| safety rules | `src/core/safety.ts` | 已覆盖主规则：system/developer、recent、代码块、错误栈、文件路径、shell、diff、测试失败、记忆指令、用户决策、架构/API/配置、tool_result 引用。 |
| scorer 维度 | `src/core/scorer.ts` | 已覆盖 superseded、low_reference、age、redundancy、orphan_tool、low_value。 |
| reasons | `src/types/message.ts`、`src/core/scorer.ts` | 已覆盖，比原型的单字符串 `decisionReason` 更适合审计。 |
| report schema | `src/types/report.ts`、`src/core/reporter.ts` | 已覆盖，并已有 `top_reasons`。 |
| compress 安全副本 | `src/core/compressor.ts` | 已覆盖，且遵循当前原则：不修改原文件，只删除非 protected 的 remove_candidate。 |
| CLI 主命令 | `src/cli.ts` | 已覆盖 analyze/report/compress，当前主线正在完善 analyze 默认摘要和 `--json`。 |

结论：这些能力不需要从 `context-rot-analyzer` 重复迁移。

## 4. 当前缺失但有价值

### 4.1 compact/away_summary 信号报告

**必要性：必须集成。**

`trimctx-integration-guide.md` 指出 Claude Code JSONL 可能包含：

```json
{ "type": "system", "subtype": "away_summary", ... }
```

这代表会话已经被 Claude 自动压缩过。当前 parser 会把 system metadata flatten 成普通内容，但 report summary 没有明确暴露“此会话已发生 compact/away_summary”。

**价值：**

- 帮用户理解会话历史已经被压缩过，避免误判 token/上下文状态。
- 对 Phase 0 多样本验证有价值，因为需求文档要求至少 1 个 session 发生过 compact。
- 可以作为 report warning 或 summary flag，不影响删除决策。

**建议集成方式：**

- 在 parser 或 reporter 中检测 raw record 的 `type === "system"` 和 `subtype === "away_summary"`。
- 在 report `warnings` 或 summary 中加入类似 `contains_away_summary: true` 的信号。
- 不把 away_summary 作为 remove_candidate。

**目标阶段：v0.2。**

**验证方式：**

- 添加包含 `away_summary` 的 sanitized fixture。
- 断言 report warnings 或 summary 包含 compact 信号。

### 4.2 真实样本洞察整理

**必要性：必须集成。**

`trimctx-integration-guide.md` 总结了真实 Claude Code JSONL 的 9 种行类型、tool_result 结构、流式 assistant 去重、Read tool_result token 估算偏差。这些不是新模块，但应沉淀成 parser 验证清单或 Phase 0 验证文档。

**价值：**

- 直接支撑 Phase 0 多样本验证。
- 防止 parser 后续回退。
- 帮助定义 sanitized fixtures。

**建议集成方式：**

- 把真实样本边界整理进 `docs/work/integration-value-assessment.md` 或后续 `docs/phase0-validation-notes.md`。
- 后续实现时转成 parser fixtures 和 tests。

**目标阶段：v0.2。**

**验证方式：**

- 至少覆盖 metadata 行、tool_result string/list、assistant 流式分片、isMeta、away_summary。

### 4.3 entity extraction 实体抽取

**必要性：可选集成。**

原型包的 `entityExtractor.ts` 能提取：

- file paths
- function names
- class names
- error messages
- variable names
- decision keywords
- supersede targets

当前 `src/core/scorer.ts` 只有内部 `keywords()`，它适合粗略 low_reference/redundancy，但不适合稳定说明“这条消息因为哪些实体被后续引用/未引用”。

**价值：**

- 改善 `low_reference_score` 和 `superseded_score` 的解释力。
- 帮助减少“关键词碰巧重叠”的误判。
- 为将来的 relations/report 审计提供基础。

**风险：**

- 正则抽取可能带来误判，尤其是 PascalCase、函数名和路径。
- 一旦参与删除决策，可能影响 safety，需要真实样本验证。

**建议集成方式：**

- 先作为 report/debug 辅助信息或 scorer 内部低权重信号。
- 不要第一步就让实体抽取直接决定 remove_candidate。
- 只引入少量高信号实体：文件路径、错误名、函数/类名。

**目标阶段：v0.2 后半或 v0.3。**

**验证方式：**

- 单测覆盖路径、函数、类、错误、决策关键词。
- 在真实样本上对比 remove_candidate precision 是否下降。

### 4.4 token 估算增强

**必要性：可选集成。**

当前 `ApproxTokenizer` 简洁：

```ts
cjk + words + message overhead
```

`docs/work` 建议区分英文、中文、代码块、Read tool_result，并指出长 skill 文档 `content.length / 4` 可能低估。

**价值：**

- 改善 estimated saving 的可信度。
- 对大块 Read/tool_result 更接近真实 token。
- 不直接影响删除安全，但影响用户判断收益。

**风险：**

- 估算规则复杂后不一定更准。
- 如果缺少真实 token 对照，容易“看起来精细但不可验证”。

**建议集成方式：**

- 保持 tokenizer 无外部依赖。
- 增加可解释 breakdown 前先补对照测试。
- 仅对明显长 tool_result 或代码块调整估算，不全面重写。

**目标阶段：v0.2 后半。**

**验证方式：**

- 构造中文、英文、代码块、长 tool_result fixtures。
- 对比估算变化是否符合预期。

### 4.5 report 维度增强

**必要性：可选集成。**

当前 report 已有 summary、messages、remove_candidates、warnings、top_reasons，但没有：

- candidate category
- confidence
- entity references
- compact signal
- per-category saving

原型有 `confidence` 和 relations 概念，cliReporter 也有候选分组展示。

**价值：**

- 提升可审计性。
- 帮用户快速理解候选来自 metadata、tool_result、重复内容还是过时指令。
- 适合配合 `analyze` 默认摘要继续优化。

**风险：**

- report schema 过早扩张会增加兼容成本。
- v0.2 重点仍是短摘要、`--json`、Phase 0。

**建议集成方式：**

- 优先增加不破坏现有字段的 summary 衍生信息。
- 不重命名现有 report schema。
- `confidence` 先作为内部或可选字段评估。

**目标阶段：v0.2。**

**验证方式：**

- 测试 report summary 中新增字段。
- 确认 `analyze --json` 与 `report` 输出一致。

## 5. 当前缺失但暂缓

### 5.1 relations 关系图谱

**必要性：暂缓。**

原型中 relations 包括：

- `tool_pair`
- `entity_ref`
- `supersedes`
- `causal`

这对审计很有价值，但实现成本和报告复杂度较高。当前项目最重要的是 v0.2 CLI 可用性和 Phase 0 多样本验证，不宜现在引入完整关系图。

**建议：**

- 暂不做顶层 `relations` report。
- 先做 entity extraction 或 compact signal 这种局部增量。
- 等真实样本验证稳定后，再考虑关系图谱。

**目标阶段：v0.3+。**

### 5.2 配置化阈值

**必要性：暂缓。**

原型和文档提到 recent window、score 权重、阈值可配置。当前 `src/core/safety.ts` 和 `src/core/scorer.ts` 里确实有硬编码窗口和权重。

**价值：**

- 有助于真实样本调参。
- 便于未来不同用户场景调整保守程度。

**暂缓原因：**

- 默认行为还在校准，过早暴露配置会增加支持成本。
- 用户可能调低保护阈值导致误删风险。

**建议：**

- v0.2 先保留默认值。
- 内部可以先提取常量，但不对外开放配置。
- Phase 0 后再决定是否加 config 文件或 CLI flags。

**目标阶段：v0.3+。**

## 6. 不建议集成

### 6.1 直接迁移原型 parser

不建议。

原因：

- 当前 parser 已支持真实 Claude Code metadata 记录和 OpenAI JSONL。
- 当前 `parseJsonl` 通过扫描前 25 条记录判断格式，比原型示例更稳。
- 原型 parser 示例会跳过较多 metadata，但 trimctx 当前需要保留 raw/rawLine/sourceLine 以便审计。

### 6.2 直接迁移原型 types/report schema

不建议。

原因：

- 当前类型已包含 `developer`、`unknown`、`source`、`sourceLine`、`rawLine`、`raw`、`sessionId`、`parentId`。
- 当前 report 已按 `trimctx.report.v1` 稳定化。
- 直接迁移会破坏现有测试和 CLI 输出。

### 6.3 直接迁移 cliReporter

不建议。

原因：

- 当前 v0.2 已明确 `analyze` 默认短摘要、`--json` 完整输出。
- 原型 reporter 是算法 demo 风格，不应替代当前 CLI UX。
- 可以借鉴候选分组展示，但不应复制实现。

### 6.4 compress_candidate 摘要化

不建议当前集成。

原因：

- 当前安全原则是“宁可少删，也不要误删”。
- v0.1/v0.2 没有 LLM，不应生成摘要替代原文。
- 当前 `compress` 只删除非 protected 的 remove_candidate，保留 compress_candidate，这是更安全的策略。

## 7. 推荐后续变更

| 建议 change | 优先级 | 内容 |
|---|---:|---|
| `add-compact-signal-reporting` | P0 | 检测 `away_summary` / compact 信号并写入 report warnings/summary |
| `add-parser-edge-fixtures` | P0 | 将 docs/work 中真实 JSONL 边界转为 sanitized fixtures |
| `improve-token-estimation-for-large-tools` | P1 | 针对长 tool_result、代码块和中英文混合内容增强 token 估算 |
| `add-entity-extraction-signals` | P1 | 引入文件/函数/错误等实体抽取，先用于解释和低权重引用判断 |
| `add-candidate-category-summary` | P1 | 在 report/analyze 中展示候选类别和节省分布 |
| `add-relations-report` | P2 | 增加顶层 relations 审计图谱 |
| `make-scoring-configurable` | P2 | 在默认行为稳定后再暴露阈值/权重配置 |

## 8. 最终建议

`docs/work` 的价值不在于“提供一套应直接迁移的实现”，而在于暴露了当前 trimctx 后续可以增强的几个方向：

1. compact/away_summary 信号。
2. 真实 JSONL 边界 fixture。
3. 实体抽取。
4. 更准确的 token 估算。
5. 更丰富但仍可控的 report 审计维度。

其中前两项最贴近当前 v0.2 和 Phase 0，应优先处理。relations 和配置化虽然有价值，但应等 CLI 可用性和真实样本验证稳定后再做。
