---
name: OpenSpec: Apply
description: 实现已批准的 OpenSpec change，并同步 tasks 状态。
category: OpenSpec
tags: [openspec, apply]
---

# User Input
```text
$ARGUMENTS
```

# 目标

根据 `openspec/changes/<change-id>/tasks.md` 实现变更，保持任务状态同步，并完成必要验证。

# 前置条件

必须存在：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/`
- `openspec/changes/<change-id>/tasks.md`

建议存在：

- `openspec/changes/<change-id>/design.md`
- `openspec/changes/<change-id>/data-model.md`（如涉及数据模型）

如果缺少 `tasks.md`，停止并提示先运行 `/openspec:plan <change-id>`。

# 阶段边界

- 只实现 tasks 中列出的内容。
- 可以修改业务代码、测试、配置和必要文档。
- 每完成一个任务，更新 `tasks.md` checkbox。
- 不扩大范围，不做顺手重构。
- 如果实现中发现 proposal/spec/design/tasks 有问题，停止并和用户确认是否回到 `/openspec:plan` 修正。

# 工作流程

## 1. 解析 change-id

1. 从 `$ARGUMENTS` 获取 `change-id`。
2. 如果没有提供，尝试从对话上下文推断。
3. 如果有歧义，运行 `openspec list --json` 或列出 `openspec/changes/`，让用户选择。

## 2. 读取 artifacts 和规则

读取：

- `proposal.md`
- 所有 `specs/**/*.md`
- `design.md`（如存在）
- `data-model.md`（如存在）
- `tasks.md`
- 项目相关规则和现有代码

结构性问题优先用 CodeGraph；文本匹配用 `rg`。

## 3. 显示当前进度

解析 `tasks.md`：

- 统计 `- [x]` 已完成任务。
- 统计 `- [ ]` 待办任务。
- 展示当前进度："N/M 个任务完成"。
- 从第一个未完成任务开始。

如果所有任务已完成，说明无需实现，建议运行 `/openspec:verify <change-id>`。

## 4. 按任务实现

对每个待办任务：

1. 简短说明正在处理的任务。
2. 如任务涉及行为变化或风险较高，先写或更新自动化测试，并确认它能覆盖对应 scenario。
3. 用最小实现通过测试。
4. 必要时重构，但只限于当前任务需要。
5. 更新 `tasks.md`：`- [ ]` -> `- [x]`。
6. 继续下一个任务。

暂停条件：

- 任务描述不清楚。
- 实现方案与 design/spec 冲突。
- 发现需要新增范围。
- 测试体系缺失且无法合理验证。
- 用户中断。

## 5. 验证

根据项目和 tasks 运行必要验证。优先：

```bash
npm test
npm run build
```

如果任务中指定了更小的命令，优先运行更聚焦的测试，再运行必要的整体检查。

如果无法运行某项验证，说明原因，不要声称已通过。

## 6. 收尾

确认：

- tasks checkbox 与实际完成状态一致。
- specs 中的关键 scenarios 已有实现或测试覆盖。
- 没有修改原始输入数据或无关文件。
- 没有引入未要求的兼容性代码。

# 输出

完成后汇总：

- 完成的任务数量。
- 修改过的文件。
- 运行过的验证命令和结果。
- 剩余风险或未完成项。
- 下一步：运行 `/openspec:verify <change-id>`。

# 守卫规则

- Apply 阶段只实现计划内内容。
- 遵循 TDD：先测试，再最小实现，再重构。
- protected、原始输入、真实样本等项目约束必须遵守。
- 不确定点先确认，不要猜测扩大范围。
- 所有文档和任务说明使用中文；代码标识和命令保持英文。
