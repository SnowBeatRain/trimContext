---
name: OpenSpec: Archive
description: 归档已完成的 OpenSpec change，并同步 delta specs。
category: OpenSpec
tags: [openspec, archive]
---

# User Input
```text
$ARGUMENTS
```

# 目标

在确认变更已完成后，将 delta specs 同步到主 specs，并归档 change。

# 前置条件

必须有明确的 `change-id`，并且该变更已经完成实现和验证。

建议先运行：

```text
/openspec:verify <change-id>
```

如果 verify 发现 CRITICAL 问题，停止归档，提示先修复。

# 阶段边界

- 可以读取 change artifacts、主 specs 和任务状态。
- 可以更新主 specs。
- 可以执行 OpenSpec archive。
- 不写业务代码。
- 不修复实现问题；发现实现问题时回到 `/openspec:apply`。

# 工作流程

## 1. 确认 change-id

1. 如果用户提供了 `change-id`，直接使用。
2. 如果只描述了变更内容，运行 `openspec list --json` 或列出 `openspec/changes/`，让用户选择。
3. 如果仍无法确认，停止并要求用户提供明确 `change-id`。

不要自动猜测。

## 2. 检查完成状态

读取：

- `openspec/changes/<change-id>/proposal.md`
- `openspec/changes/<change-id>/specs/**/*.md`
- `openspec/changes/<change-id>/tasks.md`
- `design.md`、`data-model.md`（如存在）

检查：

- 所有 tasks 是否为 `- [x]`。
- 是否仍有 open questions。
- 是否存在明显未同步的 spec delta。
- 最近是否运行过验证；如果没有，建议先运行 `/openspec:verify <change-id>`。

如果存在未完成 tasks，提示用户确认。默认不要归档未完成变更。

## 3. 同步 delta specs 到主 specs

对每个：

```text
openspec/changes/<change-id>/specs/<capability>/spec.md
```

读取对应主 spec：

```text
openspec/specs/<capability>/spec.md
```

按 delta section 智能合并：

- `## ADDED Requirements`
  - 主 spec 不存在该 requirement：新增。
  - 主 spec 已存在：更新为一致内容，视为隐式 MODIFIED。
- `## MODIFIED Requirements`
  - 找到主 spec 中对应 requirement。
  - 只应用 delta 提到的修改。
  - 保留未提及的 scenarios 和说明。
- `## REMOVED Requirements`
  - 删除主 spec 中对应 requirement block。
- `## RENAMED Requirements`
  - 按 FROM/TO 重命名。

如果主 spec 不存在，创建：

```text
openspec/specs/<capability>/spec.md
```

并包含简短 Purpose 和 Requirements。

同步原则：

- delta 表达的是意图，不是整文件替换。
- 合并应幂等，重复运行不应产生重复 requirement 或 scenario。
- 不清楚时停止并询问用户。

## 4. 执行归档

优先使用 CLI：

```bash
openspec archive "<change-id>" --yes
```

如果本项目使用手动目录归档，则将 change 移入：

```text
openspec/changes/archive/YYYY-MM-DD-<change-id>/
```

归档前确认目标目录不存在。若已存在，停止并提示用户处理冲突。

只有用户明确要求且本次变更不需要更新 specs 时，才允许使用 `--skip-specs`。

## 5. 核对结果

确认：

- change 已移动到 archive。
- 主 specs 已按预期更新。
- 没有遗漏未完成 tasks。
- 输出中没有 CLI 错误。

# 输出

完成后汇总：

- 归档的 `change-id`
- 归档位置
- 更新的 capability specs
- 是否跳过 specs 同步
- 任何警告

# 守卫规则

- 归档前必须确认唯一 `change-id`。
- 默认不归档未完成 tasks。
- 默认同步 specs，不要静默跳过。
- 不在 Archive 阶段修业务代码。
- 状态异常时先停止并说明，不要强行归档。
