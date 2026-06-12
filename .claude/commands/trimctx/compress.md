# /trimctx:compress — 压缩最近的会话

运行 `trimctx current --source auto --compress trimmed.jsonl` 压缩最近的 Claude Code 或 Codex 会话文件。

压缩完成后告知用户：
1. 移除了多少条消息
2. 节省了多少 tokens
3. 原文件未被修改，压缩结果在 `trimmed.jsonl`

注意：
- 不要覆盖原始会话文件。
- 如果用户希望指定输出位置，应改用 `trimctx current --source auto --compress <output.jsonl>`。
