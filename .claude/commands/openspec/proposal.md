---
name: OpenSpec: Proposal
description: 探索需求并创建 OpenSpec 变更提案与 specs。
category: OpenSpec
tags: [openspec, proposal]
---

# User Input
```text
$ARGUMENTS
```

# 目标

创建一个新的 OpenSpec change，并产出提案阶段 artifacts：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/<capability>/spec.md`

`change-id` 是贯穿 proposal、plan、apply、verify、archive 的唯一标识，必须使用 kebab-case，建议用动词开头，例如 `add-json-summary`、`fix-session-detection`。

# 阶段边界

Proposal 阶段只做探索、范围确认、proposal 和 specs：

- 可以读取文件、搜索代码、分析现状。
- 可以和用户讨论需求、范围、非目标、风险。
- 可以创建 `proposal.md` 和 `specs/<capability>/spec.md`。
- 不写实现代码。
- 不创建 `design.md`、`data-model.md`、`tasks.md`，这些属于 `/openspec:plan`。
- 不修改与提案无关的项目文件。

# 工作流程

## 1. 解析输入

1. 读取 `$ARGUMENTS`。
2. 如果用户提供了明确的 `change-id`，直接使用。
3. 如果用户提供的是自然语言需求，先理解需求，再生成 kebab-case `change-id`。
4. 如果没有输入或意图不清楚，询问用户：
   > 你想处理什么变更？请描述你想构建或修复的内容。

不要在不理解需求的情况下创建 change。

## 2. 探索上下文

优先读取项目 OpenSpec 和现有文档：

1. 如果存在 `AGENTS.md`、`docs/iteration-plan.md`、`docs/requirements.md`、`docs/usage.md`、`docs/roadmap.md`、`docs/execution-plan.md`、`docs/status-and-next-steps.md`，按需读取相关部分。
2. 如果存在 `spec-docs/product-rule.md`，先读取产品规则。
3. 运行或参考 `openspec list --json`，确认是否已有相关 active changes。
4. 调查当前代码实现，优先使用 CodeGraph 处理结构性问题，使用 `rg` 处理文本搜索。
5. 找到相关模块、已有模式、约束和潜在影响面。

探索时可以画简短 ASCII 图或表格帮助说明，但不要过度文档化。

## 3. 与用户对齐

在写文件前，先和用户确认以下内容：

- **问题背景**：为什么要做这个变更。
- **目标**：完成后用户能获得什么。
- **核心功能**：本次变更必须交付的 1-5 个核心功能点。
- **范围**：本次会改什么。
- **非目标**：本次明确不做什么。
- **能力拆分**：需要新增或修改哪些 capability。
- **风险与边界**：可能影响哪些既有行为。
- **验收信号**：什么表现说明它完成了。

如果存在多个方案，给出 2-3 个选项、权衡和推荐方案。用户确认方向后再写 artifacts。

## 4. 创建 change

创建目录：

```bash
openspec new change "<change-id>"
```

如果 CLI 不可用，则按以下结构创建目录和文件：

```text
openspec/changes/<change-id>/
|-- proposal.md
`-- specs/
```

如果同名 change 已存在，不要覆盖。询问用户是继续该 change，还是使用新名称。

## 5. 编写 proposal.md

`proposal.md` 至少包含：

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

Capabilities 是后续 specs 的来源。每个 capability 名称应稳定、简短、可作为目录名。

## 6. 编写 specs

为每个 capability 创建：

```text
openspec/changes/<change-id>/specs/<capability>/spec.md
```

使用 OpenSpec delta 格式：

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

规则：

- 每条 requirement 至少包含一个 `#### Scenario:`。
- 场景必须可测试、可验证。
- 不要把实现细节写成 requirement。
- 涉及多个 capability 时，拆成多个 spec，并说明关系。

# 输出

完成后向用户汇总：

- `change-id`
- 创建的文件路径
- 核心功能列表
- capabilities 列表
- 关键范围与非目标
- 下一步：运行 `/openspec:plan <change-id>`

# 守卫规则

- 没有用户确认方向前，不写 proposal/specs。
- Proposal 阶段不写代码、不写 tasks、不写 design。
- 不要创建无需求的兼容性内容。
- 保持最小化变更，宁可少写，也不要扩大范围。
- 所有文档使用中文；OpenSpec 关键字、CLI 参数、JSON 字段保持英文。
