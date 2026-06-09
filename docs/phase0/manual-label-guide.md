# Phase 0 人工标注指南

## 目标

对每个验证样本的 `remove_candidate` 列表进行人工审查，判断 trimctx 的删除建议是否正确。

## 标注流程

### 第一步：运行报告

```bash
trimctx report datasets/private/raw/session-NNN.jsonl -o reports/phase0/session-NNN.report.json
```

### 第二步：提取 remove_candidates

从报告 JSON 中提取所有 `decision === "remove_candidate"` 的消息，记录：

- `message_index`（在 messages 数组中的位置）
- `role`（user / assistant / tool）
- `reasons`（trimctx 给出的删除理由）
- `content` 前 200 字符（用于人工判断）

### 第三步：逐条标注

对每条 remove_candidate，判断：

| 标签 | 含义 | 判断标准 |
| --- | --- | --- |
| `correct_remove` | 确实可以删除 | 内容过时、被后续覆盖、孤立 tool_result、重复解释 |
| `wrong_remove` | 误判，实际应保留 | 包含最终采纳的方案、包含关键上下文、包含用户确认的决策 |
| `borderline` | 边界情况 | 内容部分过时但仍有参考价值 |

### 第四步：记录标注

写入 `datasets/private/labels/session-NNN.labels.json`：

```json
{
  "session_id": "session-NNN",
  "reviewer": "你的名字",
  "review_date": "2026-06-09",
  "labels": [
    {
      "message_index": 41,
      "predicted_decision": "remove_candidate",
      "human_label": "correct_remove",
      "reason": "孤立 tool_result，后续无引用"
    },
    {
      "message_index": 82,
      "predicted_decision": "remove_candidate",
      "human_label": "wrong_remove",
      "reason": "包含最终采纳的架构决策"
    }
  ]
}
```

## 重点关注

- **用户纠正模式**：用户说"不要这样做"后，旧方案应被删除，但纠正本身必须保留。
- **tool_result 孤立**：如果后续 assistant 没有引用该 tool_result 的内容，通常可以删除。
- **代码块**：如果代码块是最终采纳的版本，必须保留。
- **系统消息**：任何 system/developer 消息都不应出现在 remove_candidate 中。

## 计算指标

标注完成后：

```
precision = correct_remove / (correct_remove + wrong_remove)
critical_false_deletion = wrong_remove 中包含 protected 内容的数量
```

目标：precision >= 70%，critical_false_deletion = 0。
