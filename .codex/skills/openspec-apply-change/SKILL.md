---
name: openspec-apply-change
description: 实现已批准的 OpenSpec change，并同步 tasks 状态。用户想“实现变更 / apply / 继续执行 tasks / 写代码”时使用。此 skill 对齐 Claude 的 /openspec:apply：只实现 tasks.md 中列出的内容，遵循 TDD，完成后建议 verify。
license: MIT
compatibility: Requires project test/build commands; openspec CLI optional for discovery.
metadata:
  author: trimctx
  alignedWith: ".claude/commands/openspec/apply.md"
---

# OpenSpec Apply

目标：根据 `openspec/changes/<change-id>/tasks.md` 实现变更，保持任务状态同步，并完成必要验证。

## 前置条件

必须存在：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/`
- `openspec/changes/<change-id>/tasks.md`

建议存在：

- `design.md`
- `data-model.md`（如涉及数据模型）

缺少 `tasks.md` 时停止，并提示先使用 `openspec-continue-change`。

## 阶段边界

- 只实现 tasks 中列出的内容。
- 可以修改业务代码、测试、配置和必要文档。
- 每完成一个任务，更新 `tasks.md` checkbox。
- 不扩大范围，不做顺手重构。
- 如果实现中发现 proposal/spec/design/tasks 有问题，停止并和用户确认是否回到 plan 阶段修正。

## 工作流程

1. 确认 `change-id`。如有歧义，运行 `openspec list --json` 或列出 `openspec/changes/` 让用户选择。
2. 读取 `proposal.md`、所有 specs、`design.md`、`data-model.md`、`tasks.md` 和项目规则。
3. 解析 `tasks.md`，展示进度：`N/M 个任务完成`。
4. 从第一个未完成任务开始执行。
5. 对行为变化或高风险任务，先写或更新自动化测试。
6. 用最小实现通过测试。
7. 必要时重构，但只限当前任务需要。
8. 完成任务后立即将 `- [ ]` 改为 `- [x]`。
9. 继续直到任务完成或遇到阻塞。

结构性代码问题优先用 CodeGraph；文本搜索用 `rg`。

## 暂停条件

- 任务描述不清楚。
- 实现方案与 design/spec 冲突。
- 发现需要新增范围。
- 测试体系缺失且无法合理验证。
- 用户中断。

## 验证

根据项目和 tasks 运行必要验证。优先：

```bash
npm test
npm run build
```

如果任务指定了更小命令，先运行聚焦测试，再运行必要整体检查。无法运行某项验证时说明原因，不要声称已通过。

## 输出

完成后汇总：

- 完成的任务数量。
- 修改过的文件。
- 运行过的验证命令和结果。
- 剩余风险或未完成项。
- 下一步：使用 `openspec-verify-change`。

## 守卫规则

- Apply 阶段只实现计划内内容。
- 遵循 TDD：先测试，再最小实现，再重构。
- 不确定点先确认，不要猜测扩大范围。
- 不修改原始输入数据或真实样本。
- 所有文档和任务说明使用中文；代码标识和命令保持英文。
