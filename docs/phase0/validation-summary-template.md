# Phase 0 验证汇总

> 本文件由人工填写，记录多样本验证的实际结果。

## 测试环境

- trimctx 版本：____
- Node.js 版本：____
- 测试日期：____

## 样本概览

| 样本 | 类型 | messages | tokens | remove_candidates | compress_candidates |
| --- | --- | --- | --- | --- | --- |
| session-001 | 功能开发 | | | | |
| session-002 | Bug 调试 | | | | |
| session-003 | 重构任务 | | | | |
| session-004 | 文档/规划 | | | | |
| session-005 | 长工具调用 | | | | |
| **合计** | | | | | |

## 验收指标

| 指标 | 目标 | 实际 | 通过? |
| --- | --- | --- | --- |
| parser success rate | >= 95% | | |
| critical false deletion | = 0 | | |
| protected recall | = 100% | | |
| remove_candidate precision | >= 70% | | |
| 原始文件完整性 | hash 不变 | | |

## 人工审查发现

### 误判为 remove_candidate（实际应保留）

| 样本 | message_index | role | 原因 | 建议修复 |
| --- | --- | --- | --- | --- |
| | | | | |

### 漏判（实际应删除但未标记）

| 样本 | message_index | role | 说明 |
| --- | --- | --- | --- |
| | | | |

## 结论

- [ ] 5 个样本全部成功解析
- [ ] 0 个 critical false deletion
- [ ] protected recall = 100%
- [ ] remove_candidate precision >= 70%
- [ ] 原始文件未被修改
- [ ] 可进入下一阶段
