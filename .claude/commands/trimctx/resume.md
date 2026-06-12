# /trimctx:resume — 分析最近的 Claude Code 会话

运行 `trimctx current --source claude --color` 分析最近的 Claude Code 会话，将结果展示给用户。

展示结果后，用简洁的中文总结：
1. 会话健康状态和腐烂率
2. 主要问题（哪些类型的内容占用了空间）
3. 如果有 remove candidate，建议是否生成报告或显式执行压缩

注意：不要修改或删除任何原始会话文件。
