# /trimctx — 分析最新本地 AI 会话上下文

运行 `trimctx current --source auto --color` 分析最新的本地 Claude Code 或 Codex JSONL 会话，将结果展示给用户。该选择基于 JSONL 文件修改时间，不等同于通过客户端 API 精确绑定当前活跃会话。

展示结果后，用简洁的中文总结：
1. 会话健康状态和上下文压力
2. 主要腐化信号或空间占用来源
3. 是否建议继续观察、生成报告，或显式执行压缩

边界：
- 默认只分析，不修改或删除任何原始会话文件。
- 如需压缩，必须由用户明确触发 `/trimctx:compress` 或手动运行 `trimctx current --compress <output.jsonl>`。
- 如果提示找不到 `trimctx`，说明 CLI 尚未安装到 PATH；先在项目内运行 `npm link` 或使用 `node dist/cli.js current --source auto --color` 验证。
