---
name: openspec-continue-change
description: 基于已批准的 OpenSpec proposal/specs 产出设计与执行计划。用户想“继续 OpenSpec 变更 / 生成 design / 生成 tasks / 进入 plan 阶段”时使用。此 skill 对齐 Claude 的 /openspec:plan：创建 design.md、可选 data-model.md 和 tasks.md，不写实现代码。
license: MIT
compatibility: Requires openspec CLI when available; can fall back to repo-local openspec/changes layout.
metadata:
  author: trimctx
  alignedWith: ".claude/commands/openspec/plan.md"
---

# OpenSpec Plan

本 skill 对齐 Claude Code 命令 `/openspec:plan`。

目标：基于已完成并确认的 proposal/specs，创建计划阶段 artifacts：

- `openspec/changes/<change-id>/design.md`
- `openspec/changes/<change-id>/data-model.md`（仅在涉及数据模型时）
- `openspec/changes/<change-id>/tasks.md`

Plan 阶段只规划，不写实现代码。

## 前置条件

必须存在：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/`

缺失时停止，并提示先使用 `openspec-propose`。

## 选择 change

1. 从用户请求或上下文获取 `change-id`。
2. 如果没有提供且有歧义，运行 `openspec list --json` 或列出 `openspec/changes/`，让用户选择。
3. 不要猜测多个候选中的一个。

## 读取上下文

读取：

- `proposal.md`
- `specs/**/*.md`
- `AGENTS.md`
- `spec-docs/dev-code-rule.md`、`dev-common-rule.md`、`dev-design-rule.md`、`dev-project-desc.md`、`other.md`（如存在）
- 与变更相关的代码和测试

结构性问题优先用 CodeGraph；文本匹配用 `rg`。

## 校验 proposal/specs

检查：

- proposal 是否说明 Why、What Changes、Capabilities、Impact。
- 每个 capability 是否有 spec。
- 每条 requirement 是否至少有一个 scenario。
- requirement 是否可验证。
- 是否存在范围过大、边界不清、互相矛盾的问题。

如有关键缺口，停止并向用户说明要先补什么。

## 对齐设计方向

写文件前先和用户确认：

- 当前实现和目标行为的差异。
- 推荐方案与备选方案。
- 关键技术决策和取舍。
- 是否涉及数据结构、文件格式、配置、迁移或兼容影响。
- 验证方式：测试、构建、CLI 示例或人工检查。

## design.md

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

## data-model.md

以下情况需要创建：

- 新增或修改数据库 schema。
- 新增或修改持久化 JSON/JSONL/配置格式。
- 改变内部核心数据结构或对外数据契约。
- 涉及迁移、兼容或历史数据读取。

否则在 `design.md` 中说明省略原因。

## tasks.md

任务必须可执行、可验证、和 specs 对齐。

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
- 不加入未明确要求的功能。
- 不规划无需求兼容性代码。

## 输出

完成后汇总：

- 创建或更新的 artifacts
- 关键设计决策
- 任务数量和验证方式
- 下一步：使用 `openspec-apply-change`

## 守卫规则

- Plan 阶段不写实现代码。
- proposal/specs 不完整时不继续。
- 关键不确定点先确认。
- 设计和任务必须服务当前变更，避免顺手重构。
