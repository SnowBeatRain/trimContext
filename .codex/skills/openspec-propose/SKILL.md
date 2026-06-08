---
name: openspec-propose
description: 创建 OpenSpec 变更的提案阶段 artifacts。用户想开始一个新功能、修复或行为变更，或在 Codex 中说“创建 proposal / 提案 / 规范 / 变更”时使用。此 skill 对齐 Claude 的 /openspec:proposal：只产出 proposal.md 和 specs，不产出 design/tasks，不写实现代码。
license: MIT
compatibility: Requires openspec CLI when available; can fall back to repo-local openspec/changes layout.
metadata:
  author: trimctx
  alignedWith: ".claude/commands/openspec/proposal.md"
---

# OpenSpec Proposal

本 skill 对齐 Claude Code 命令 `/openspec:proposal`。

目标：创建一个新的 OpenSpec change，并产出提案阶段 artifacts：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/<capability>/spec.md`

Proposal 阶段只做探索、范围确认、proposal 和 specs。不要写实现代码，不要创建 `design.md`、`data-model.md`、`tasks.md`。

## 输入处理

1. 从用户请求中提取 `change-id` 或需求描述。
2. 如果只有自然语言需求，先理解需求，再生成 kebab-case `change-id`，建议动词开头，例如 `add-json-summary`。
3. 如果没有输入或意图不清楚，询问用户想处理什么变更。
4. 如果同名 change 已存在，不要覆盖；询问用户继续该 change 还是换名称。

## 探索上下文

按需读取：

- `AGENTS.md`
- `PLAN.md`
- `docs/requirements.md`
- `docs/usage.md`
- `docs/roadmap.md`
- `docs/execution-plan.md`
- `docs/status-and-next-steps.md`
- `spec-docs/product-rule.md`（如存在）

确认现有 OpenSpec 状态：

```bash
openspec list --json
```

调查代码时，结构性问题优先用 CodeGraph；文本搜索用 `rg`。

## 写入前对齐

写文件前，和用户确认：

- 问题背景
- 目标
- 核心功能：本次变更必须交付的 1-5 个核心功能点
- 范围
- 非目标
- capability 拆分
- 风险与边界
- 验收信号

如有多个可行方案，给出 2-3 个选项、权衡和推荐方案。用户确认后再写 artifacts。

## 创建 change

优先使用：

```bash
openspec new change "<change-id>"
```

如果 CLI 不可用，则创建：

```text
openspec/changes/<change-id>/
|-- proposal.md
`-- specs/
```

## proposal.md 结构

```markdown
## Why

说明为什么要做这个变更。

## What Changes

- 列出本次会发生的行为或能力变化。

## Core Features

- 列出本次变更必须交付的核心功能点，建议 1-5 条。

## Capabilities

### New Capabilities
- `<capability-name>`：简短说明。

### Modified Capabilities
- `<capability-name>`：简短说明。

## Impact

- 受影响的模块、命令、文件或用户流程。

## Non-Goals

- 本次明确不做的内容。

## Open Questions

- 尚未确认的问题；如果没有，写 `None`。
```

## specs 结构

为每个 capability 创建：

```text
openspec/changes/<change-id>/specs/<capability>/spec.md
```

使用 delta 格式：

```markdown
## ADDED Requirements

### Requirement: <Requirement Name>

系统 SHALL <可验证行为>。

#### Scenario: <Scenario Name>

- **WHEN** <触发条件>
- **THEN** <预期结果>
- **AND** <额外结果，如需要>
```

可用 section：

- `## ADDED Requirements`
- `## MODIFIED Requirements`
- `## REMOVED Requirements`
- `## RENAMED Requirements`

每条 requirement 至少包含一个 `#### Scenario:`。场景必须可测试、可验证。不要把实现细节写成 requirement。

## 输出

完成后汇总：

- `change-id`
- 创建的文件路径
- 核心功能列表
- capabilities 列表
- 关键范围与非目标
- 下一步：使用 `openspec-continue-change` 进入 plan 阶段

## 守卫规则

- 没有用户确认方向前，不写 proposal/specs。
- Proposal 阶段不写代码、不写 tasks、不写 design。
- 不创建无需求的兼容性内容。
- 保持最小化变更。
- 所有文档使用中文；OpenSpec 关键字、CLI 参数、JSON 字段保持英文。
