---
name: OpenSpec: Plan
description: 基于已批准的 OpenSpec proposal/specs 产出设计与执行计划。
category: OpenSpec
tags: [openspec, plan]
---

# User Input
```text
$ARGUMENTS
```

# 目标

基于已完成并确认的 proposal/specs，创建计划阶段 artifacts：

- `openspec/changes/<change-id>/design.md`
- `openspec/changes/<change-id>/data-model.md`（仅在涉及数据模型时）
- `openspec/changes/<change-id>/tasks.md`

Plan 阶段的职责是把“要做什么”转成“如何做、按什么顺序做”。本阶段不写实现代码。

# 前置条件

必须存在：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/`

如果缺失 proposal 或 specs，停止并提示先运行 `/openspec:proposal <change-id>`。

# 阶段边界

- 可以读取项目规则、代码、测试和已有实现。
- 可以和用户讨论设计方案、取舍、风险和任务拆分。
- 可以创建或更新 `design.md`、`data-model.md`、`tasks.md`。
- 不写实现代码。
- 不修改业务代码。
- 如果发现 proposal/specs 明显有问题，停止并建议先修正 proposal/specs。

# 工作流程

## 1. 解析 change-id

1. 从 `$ARGUMENTS` 获取 `change-id`。
2. 如果没有提供，尝试从上下文推断。
3. 如果有歧义，运行 `openspec list --json` 或列出 `openspec/changes/`，让用户选择。

不要猜测多个候选中的一个。

## 2. 读取上下文

优先读取：

1. `openspec/changes/<change-id>/proposal.md`
2. `openspec/changes/<change-id>/specs/**/*.md`
3. 项目规则：
   - `AGENTS.md`
   - `spec-docs/dev-code-rule.md`
   - `spec-docs/dev-common-rule.md`
   - `spec-docs/dev-design-rule.md`
   - `spec-docs/dev-project-desc.md`
   - `spec-docs/other.md`
4. 与变更相关的代码和测试。

结构性问题优先用 CodeGraph；文本匹配用 `rg`。

## 3. 校验 proposal/specs

检查：

- proposal 是否说明 Why、What Changes、Capabilities、Impact。
- 每个 capability 是否有 spec。
- 每条 requirement 是否至少有一个 scenario。
- requirement 是否可验证，而不是纯实现描述。
- 是否存在范围过大、边界不清、互相矛盾的问题。

如有关键缺口，停止并向用户说明要先补什么。

## 4. 对齐设计方向

写文件前先和用户确认：

- 当前实现和目标行为的差异。
- 推荐方案与备选方案。
- 关键技术决策和取舍。
- 是否涉及数据结构、文件格式、配置、迁移或兼容影响。
- 验证方式：测试、构建、CLI 示例或人工检查。

如果有 2-3 个可行方案，给出对比和推荐。用户确认后再生成 artifacts。

## 5. 编写 design.md

建议结构：

```markdown
## Context

当前实现、约束和相关背景。

## Goals / Non-Goals

**Goals:**
- ...

**Non-Goals:**
- ...

## Decisions

### Decision 1: <决策名称>

说明方案、理由和取舍。

## Approach

按模块说明实现方式、数据流和边界。

## Risks

- 风险与缓解方式。

## Verification

- 计划运行的测试、构建或 CLI 验证。
```

小变更可以简短，但不能省略关键决策。

## 6. 判断是否需要 data-model.md

以下情况需要 `data-model.md`：

- 新增或修改数据库 schema。
- 新增或修改持久化 JSON/JSONL/配置格式。
- 改变内部核心数据结构或对外数据契约。
- 涉及迁移、兼容或历史数据读取。

建议结构：

```markdown
## Entities / Structures

说明实体、字段、类型和含义。

## Relationships

说明关联关系或嵌套结构。

## Validation

说明校验规则。

## Migration / Compatibility

说明迁移策略；如果不需要，明确写明原因。
```

如果不需要 `data-model.md`，在 `design.md` 中写明省略原因。

## 7. 编写 tasks.md

任务必须可执行、可验证、和 specs 对齐。

建议结构：

```markdown
## 1. <阶段或模块>

- [ ] 1.1 [CAP:<capability>] 编写失败测试，覆盖 <scenario>。
- [ ] 1.2 [CAP:<capability>] 修改 <file> 实现 <行为>。

## 2. Verify

- [ ] 2.1 运行 <test command>。
- [ ] 2.2 运行 <build/check command>。
```

规则：

- 遵循 TDD：高风险或行为变更必须先写失败测试。
- 每个任务要有明确文件、行为或验证对象。
- 可并行任务可标记 `[P]`。
- 不要加入未明确要求的功能。
- 不要规划无需求兼容性代码。
- 如果项目没有对应测试体系，说明原因并给出可执行验证方式。

# 输出

完成后汇总：

- 创建或更新的 artifacts
- 关键设计决策
- 任务数量和验证方式
- 下一步：运行 `/openspec:apply <change-id>`

# 守卫规则

- Plan 阶段不写实现代码。
- proposal/specs 不完整时不继续。
- 任何关键不确定点必须先和用户确认。
- 设计和任务必须服务当前变更，避免顺手重构。
- 所有文档使用中文；代码标识、命令、OpenSpec 关键字保持英文。
