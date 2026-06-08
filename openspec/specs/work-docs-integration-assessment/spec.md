# work-docs-integration-assessment Specification

## Purpose
TBD - created by archiving change evaluate-work-docs-integration. Update Purpose after archive.
## Requirements
### Requirement: Work Docs Capability Extraction

系统 SHALL 从 `docs/work` 下的材料中提取核心功能点，并说明这些功能点解决什么问题，而不只是复述文件摘要。

#### Scenario: Extract core capabilities from docs/work

- **WHEN** 用户要求分析 `docs/work` 下的功能材料
- **THEN** 系统列出材料中出现的核心功能点
- **AND** 系统说明每个功能点的用途、来源材料和预期收益
- **AND** 系统区分“功能能力”和“历史实现方案”

### Requirement: Current Implementation Comparison

系统 SHALL 将 `docs/work` 中提出的能力与当前 trimctx 已实现能力进行对比，识别当前项目没有的功能缺口，避免重复集成已经存在的功能。

#### Scenario: Compare proposed capabilities with current source

- **WHEN** 系统完成 `docs/work` 材料盘点
- **THEN** 系统检查当前 `src/`、`docs/requirements.md`、`docs/roadmap.md` 和 `docs/status-and-next-steps.md`
- **AND** 系统把能力标记为“已覆盖”“当前缺失但有价值”“当前缺失但暂缓”“不建议集成”
- **AND** 系统说明每个判断的依据

### Requirement: Missing Core Value Identification

系统 SHALL 明确指出 `docs/work` 中哪些核心功能点是当前 trimctx 没有的，并判断它们是否值得集成。

#### Scenario: Identify valuable missing capabilities

- **WHEN** `docs/work` 提供的能力当前项目尚未实现
- **THEN** 系统说明该能力解决的具体问题
- **AND** 系统评估它对当前 v0.2 主线的价值
- **AND** 系统给出必要性等级：必须集成、可选集成、暂缓或不建议集成
- **AND** 系统说明该能力如果不集成会有什么影响

### Requirement: Integration Necessity Assessment

系统 SHALL 判断 `context-rot-analyzer` 原型和相关方案是否有必要集成，并给出保守、安全的集成策略，重点避免把已被当前项目覆盖的旧实现重复迁入。

#### Scenario: Assess whether to integrate prototype package

- **WHEN** `docs/work` 中包含原型包或历史集成方案
- **THEN** 系统评估其可复用价值、直接集成风险和当前项目适配成本
- **AND** 系统不得建议直接覆盖现有实现
- **AND** 系统给出符合当前 v0.2 主线的集成优先级

### Requirement: Actionable Integration Recommendation

系统 SHALL 输出可执行的后续建议，为 plan 阶段拆分任务提供输入。

#### Scenario: Produce next-step recommendations

- **WHEN** 评估完成
- **THEN** 系统给出已覆盖项、建议集成项、暂缓项和不建议项
- **AND** 每个建议集成项包含理由、预期收益、风险、目标阶段和验证方式
- **AND** 系统明确下一步应进入 `/openspec:plan` 或 `openspec-continue-change`，而不是直接实现

