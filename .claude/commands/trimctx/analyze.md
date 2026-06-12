# /trimctx:analyze — 分析指定会话文件

用户需要提供文件路径参数 $ARGUMENTS。将 `$ARGUMENTS` 视为单个文件路径，不要追加 shell 片段或额外参数。

运行 `trimctx analyze "$ARGUMENTS" --color` 分析指定的 JSONL 会话文件，将结果展示给用户。

展示结果后，用简洁的中文总结：
1. 会话健康状态和腐烂率
2. 主要问题
3. 建议

注意：不要修改或删除任何原始会话文件。
