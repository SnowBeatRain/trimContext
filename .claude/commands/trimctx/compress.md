# /trimctx:compress — 压缩最近的会话

运行 `trimctx resume --compress trimmed.jsonl` 压缩最近的会话文件。

压缩完成后告知用户：
1. 移除了多少条消息
2. 节省了多少 tokens
3. 原文件未被修改，压缩结果在 trimmed.jsonl

注意：不要修改或删除任何原始会话文件。
