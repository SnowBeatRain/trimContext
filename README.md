# trimctx

trimctx 是一个本地 AI 长对话上下文精简工具。它读取 Claude Code / OpenAI JSONL 对话记录，识别过时、重复、低价值、未引用的上下文内容，输出可审计报告，并生成安全的压缩副本。

trimctx 的第一原则是：宁可少删，也不要误删。原始 JSONL 永远不会被 `compress` 修改。

## 当前状态

当前项目处于 v0.1 Core CLI 阶段：

- 已支持 Claude Code JSONL 和 OpenAI JSONL 解析。
- 已支持 `analyze` / `report` / `compress`。
- 已有 parser、tokenizer、safety、scorer、reporter、compressor 和基础测试。
- 已用真实 Claude Code 长会话验证 safety/scorer 调校效果。

下一阶段重点是 v0.2 CLI 可用性：`analyze` 默认短摘要、`analyze --json`、top reasons、`latest` / `sessions`、`doctor`。

## 快速开始

安装依赖：

```bash
npm install
```

运行测试和构建：

```bash
npm test
npm run build
```

从源码运行 CLI：

```bash
npx tsx src/cli.ts analyze path/to/session.jsonl
npx tsx src/cli.ts report path/to/session.jsonl -o report.json
npx tsx src/cli.ts compress path/to/session.jsonl -o session.trimmed.jsonl
```

构建后运行：

```bash
node dist/cli.js analyze path/to/session.jsonl
node dist/cli.js report path/to/session.jsonl -o report.json
node dist/cli.js compress path/to/session.jsonl -o session.trimmed.jsonl
```

## 命令说明

- `trimctx analyze <file>`：分析 JSONL 并输出完整 JSON 报告。v0.2 会改成默认短摘要，并保留 `--json` 输出完整 JSON。
- `trimctx report <file> -o <report.json>`：写入完整 JSON 报告。
- `trimctx compress <file> -o <output.jsonl>`：写入安全压缩副本，只删除非 protected 的 `remove_candidate`。

## 文档地图

- [项目需求文档](docs/requirements.md)：项目目标、用户、边界、功能需求、安全需求和验收标准。
- [使用说明文档](docs/usage.md)：安装、运行、命令、输出和安全注意事项。
- [路线图](docs/roadmap.md)：v0.1 到 v0.5 阶段成果和开源门槛。
- [执行计划](docs/execution-plan.md)：数据集、人工标注、报告格式、任务拆解和 Phase 0 验收。
- [当前状态](docs/status-and-next-steps.md)：已完成内容、真实样本验证和下一步。
- [长期愿景](PLAN.md)：产品定位和最终体验。

## 安全模型

以下内容默认保护，不会被压缩删除：

- system / developer 消息
- 最近 6 轮 user / assistant
- 代码块、错误栈、文件路径、shell 命令、git diff
- 测试失败信息
- 记忆类指令
- 用户明确决策
- 架构 / API / schema / 配置变更
- 被后续自然语言总结引用的关键 tool_result

`compress_candidate` 在 v0.1 只作为报告提示，`compress` 不会删除它。

## 开源前提醒

- 不要提交真实用户 transcript。
- 私有验证数据放在 `datasets/private/`。
- 本地真实样本输出放在 `tmp-real-validation/`。
- 发布前必须补齐 `LICENSE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`SECURITY.md`、CI 和 npm package metadata。

