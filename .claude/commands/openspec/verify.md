---
name: OpenSpec: Verify
description: 归档前验证实现是否匹配 OpenSpec artifacts。
category: OpenSpec
tags: [openspec, verify]
---

# User Input
```text
$ARGUMENTS
```

# 目标

在归档前验证实现是否匹配 proposal、specs、design 和 tasks，输出可执行的问题清单。

Verify 阶段不修代码，不更新 tasks，不归档。它只做检查和报告。

# 前置条件

必须存在：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/`
- `openspec/changes/<change-id>/tasks.md`

如果缺少 tasks，提示先运行 `/openspec:plan <change-id>`。

# 工作流程

## 1. 确认 change-id

1. 从 `$ARGUMENTS` 获取 `change-id`。
2. 如果没有提供，尝试从上下文推断。
3. 如果有歧义，运行 `openspec list --json` 或列出 `openspec/changes/`，让用户选择。

不要猜测。

## 2. 读取 artifacts

读取：

- `proposal.md`
- 所有 `specs/**/*.md`
- `design.md`（如存在）
- `data-model.md`（如存在）
- `tasks.md`

同时读取与变更相关的代码和测试。结构性问题优先用 CodeGraph；文本匹配用 `rg`。

## 3. 验证完整性 Completeness

检查 tasks：

- 统计 `- [x]` 和 `- [ ]`。
- 每个未完成任务都是 CRITICAL。
- 如果任务写得无法验证，标记 WARNING，并说明需要如何改写。

检查 specs：

- 提取所有 `### Requirement:`。
- 提取所有 `#### Scenario:`。
- 判断每个 requirement/scenario 是否有实现或测试证据。
- 找不到实现迹象的 requirement 标记 CRITICAL。
- 找不到测试或验证证据的 scenario 标记 WARNING。

## 4. 验证正确性 Correctness

对每个 requirement：

- 查找相关实现文件、函数、测试。
- 判断实现是否满足 spec 的 WHEN/THEN/AND。
- 如实现和 spec 明显不一致，标记 WARNING 或 CRITICAL。
- 引用具体文件和行号，格式：`path/to/file.ts:123`。

级别判断：

- 行为缺失或会导致主场景失败：CRITICAL。
- 行为可能偏离但需要确认：WARNING。
- 风格、覆盖细节或小改进：SUGGESTION。

## 5. 验证一致性 Coherence

如果存在 `design.md`：

- 提取关键 decisions、approach、risks、verification。
- 检查实现是否遵循设计。
- 如果实现偏离设计但可能合理，标记 WARNING，并建议更新 design 或实现。

如果存在 `data-model.md`：

- 检查字段、结构、校验、迁移说明是否和实现一致。
- 数据模型不一致且影响行为时标记 CRITICAL。

检查项目模式：

- 文件命名、目录位置、模块边界是否符合既有模式。
- 是否引入不必要抽象或无需求兼容性代码。

## 6. 运行验证命令

根据项目和 tasks 运行必要命令。优先：

```bash
npm test
npm run build
```

如果有更聚焦测试，先运行聚焦测试。无法运行时说明原因。

不要在命令失败时声称通过。

# 输出格式

使用以下结构：

```markdown
## Verification Report: <change-id>

### Summary

| Dimension | Status |
|---|---|
| Completeness | ... |
| Correctness | ... |
| Coherence | ... |
| Commands | ... |

### CRITICAL

- [ ] <问题>。建议：<具体动作>。引用：`file.ts:123`

### WARNING

- [ ] <问题>。建议：<具体动作>。

### SUGGESTION

- [ ] <问题>。建议：<具体动作>。

### Final Assessment

<是否可以归档，以及下一步>
```

最终判断：

- 有 CRITICAL：不能归档，先运行 `/openspec:apply <change-id>` 修复。
- 只有 WARNING/SUGGESTION：可以归档，但应知晓风险。
- 无问题且验证命令通过：可以运行 `/openspec:archive <change-id>`。

# 守卫规则

- Verify 只检查，不修代码。
- 不确定时降低严重级别，不夸大问题。
- 每个问题必须具体、可执行。
- 没有运行的验证必须明确说明。
- 不要输出模糊建议，例如“建议检查一下”。
