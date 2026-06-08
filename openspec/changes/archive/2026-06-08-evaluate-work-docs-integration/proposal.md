## Why

`docs/work` 中包含 `context-rot-analyzer` 原型包、项目分析总览、集成指南和集成改造方案。这些材料描述了上下文腐烂分析、Claude Code JSONL 解析、评分、保护规则、报告和 CLI 集成方向，但当前项目已经实现了 parser、tokenizer、safety、scorer、reporter、compressor 和 CLI 的主干能力。

在继续开发前，需要重点判断：`docs/work` 里还有哪些核心功能点是当前 trimctx 没有的，这些功能是否有价值，是否有必要集成，以及应以什么优先级、什么边界集成，避免重复实现或把旧原型代码大范围迁入当前项目。

## What Changes

- 新增一次针对 `docs/work` 的功能价值和集成必要性评估。
- 梳理 `context-rot-analyzer` 原型与集成文档提供的核心功能点。
- 对照当前 trimctx 代码与路线图，标出当前没有的功能缺口。
- 判断每个缺口是否有集成价值、是否符合当前 v0.2 主线，以及推荐优先级。
- 给出不写实现代码的集成建议，作为后续 plan/apply 的输入。

## Core Features

- 提取 `docs/work` 下材料提供的核心功能点，而不是只做文件摘要。
- 对比当前 `src/` 已有能力，列出“当前没有但可能有价值”的功能缺口。
- 判断每个缺口的集成必要性：必须集成、可选集成、暂缓、不建议集成。
- 特别评估可能有增量价值的点，例如 entity extraction、关系图谱、配置化阈值、更细 token 估算、报告维度或真实样本洞察。
- 明确哪些内容已经被当前项目覆盖，不应重复迁移。
- 产出面向 v0.2 主线的集成优先级和验证方式。

## Capabilities

### New Capabilities
- `work-docs-integration-assessment`：分析 `docs/work` 中的原型与方案材料，识别当前项目缺失的高价值功能点，并产出集成必要性判断和建议。

### Modified Capabilities
- None

## Impact

- `docs/work/00_TrimContext项目分析总览.md`：作为原型能力、缺口和不建议直接发布原因的输入。
- `docs/work/trimctx-integration-guide.md`：作为真实 JSONL 特征、parser 细节、token 估算坑点和样本洞察输入。
- `docs/work/集成改造方案.md`：作为历史集成方案输入，但需要与当前代码状态重新对齐，避免重复实现已存在模块。
- `docs/work/context-rot-analyzer.tar.gz`：作为只读原型包输入，不直接解压覆盖项目代码。
- `openspec/changes/evaluate-work-docs-integration/`：记录本次评估变更。

## Non-Goals

- 本次不把 `context-rot-analyzer.tar.gz` 代码直接迁入 `src/`。
- 本次不修改 parser、scorer、safety、reporter、compressor 或 CLI 实现。
- 本次不实现新的 CLI 命令。
- 本次不改变当前 v0.2 主线优先级。
- 本次不提交真实样本、解压产物或生成的大型临时文件。

## Open Questions

- 评估结论最终应放在 `docs/work/`、`docs/`，还是仅保留在 OpenSpec change artifacts 中？
- 是否需要在 plan 阶段把“当前没有但有价值”的功能点拆成独立任务清单？
- 哪些功能缺口应进入当前 v0.2，哪些应推迟到 v0.3+？
