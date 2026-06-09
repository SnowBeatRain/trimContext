# Phase 0 多样本验证计划

## 目标

在继续开发新功能前，用 5 个真实 Claude Code JSONL 长对话验证当前 `analyze`/`report`/`compress` 的规则稳定性和安全边界。

## 数据集要求

| 样本 | 类型 | 最低要求 |
| --- | --- | --- |
| session-001 | 功能开发 | 100+ messages |
| session-002 | Bug 调试 | 100+ messages |
| session-003 | 重构任务 | 150+ messages |
| session-004 | 文档/规划 | 80+ messages |
| session-005 | 长工具调用任务 | 150+ messages，含大量 tool_use/tool_result |

最低总量：5 sessions / 600+ messages / 200k+ tokens。至少 1 个含大量 tool_result，至少 1 个发生过 compact，至少 1 个有用户后续纠正前面要求。

## 目录结构

```
datasets/
  private/          # 已加入 .gitignore，不进仓库
    raw/            # 原始 JSONL
    sanitized/      # 脱敏后可分享的版本（可选）
    labels/         # 人工标注文件
```

## 验收标准

| 指标 | 目标 | 说明 |
| --- | --- | --- |
| parser success rate | >= 95% | 成功解析 5 个真实 JSONL |
| critical false deletion | = 0 | protected/system/developer 消息绝不被删 |
| protected recall | = 100% | 所有应保护的消息都被保护 |
| remove_candidate precision | >= 70% | 标记为可删除的候选中，真正可删的比例 |
| 原始文件完整性 | hash 不变 | compress 不修改输入文件 |

## 执行步骤

1. 收集 5 个真实 Claude Code JSONL 到 `datasets/private/raw/`。
2. 对每个文件运行 `trimctx analyze <file> --json`，确认无崩溃。
3. 对每个文件运行 `trimctx report <file> -o reports/phase0/<session>.report.json`。
4. 对每个文件运行 `trimctx compress <file> -o reports/phase0/<session>.trimmed.jsonl`。
5. 核对输入文件 hash 不变。
6. 人工审查 remove_candidate 列表，标注误判。
7. 汇总指标到 `docs/phase0/validation-summary.md`。

## 快速运行

```bash
npx tsx scripts/phase0-run.ts --dir datasets/private/raw --out reports/phase0
```
