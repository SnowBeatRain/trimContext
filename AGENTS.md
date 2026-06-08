# trimctx Agent Instructions

## Language

中文优先。除非用户明确要求英文，否则回复、计划、状态更新、文档说明都使用简体中文。

## Project Goal

trimctx 是一个本地 AI 长对话上下文精简工具。目标是读取 Claude Code / OpenAI 长对话 JSONL，识别过时、重复、低价值、未引用内容，输出可审计报告，并生成安全压缩副本。

最终产品体验是：用户安装一次后，在 AI 内一条命令即可分析当前会话，不需要手动寻找 `.jsonl` 文件。

## Current Mainline

先阅读：

- `PLAN.md`
- `docs/requirements.md`
- `docs/usage.md`
- `docs/roadmap.md`
- `docs/execution-plan.md`
- `docs/status-and-next-steps.md`

当前主线不是做 Web UI、MCP 或安装器，而是先完成 v0.2 CLI 可用性和 Phase 0 多样本验证：

- 改善 `analyze` 的默认短摘要输出，完整 JSON 交给 `report`。
- 增加 `analyze --json`。
- 增加 top reasons。
- 补齐真实 Claude Code 多样本验证。
- 再做 `latest` / `sessions` / `doctor`。
- 保持“宁可少删，也不要误删”的安全原则。

## Technical Constraints

- Node.js 20+
- TypeScript
- commander
- vitest
- 不调用 LLM
- 不接入 Python
- 不使用数据库
- 不做 Web UI
- 不做 MCP，直到 v0.4
- 不修改原始输入 JSONL 文件

## Commands

开发验证：

```bash
npm test
npm run build
```

CLI 验证：

```bash
npx tsx src/cli.ts analyze <file>
npx tsx src/cli.ts report <file> -o report.json
npx tsx src/cli.ts compress <file> -o output.jsonl
```

真实样本路径：

```text
C:\Users\kele\.claude\projects\E--xxyWork-heli-ml-museum\5c574dba-0f62-406b-980b-a098da258ddd.jsonl
```

验证真实样本时，输出文件放到 `tmp-real-validation/`，不要改原始 JSONL。

## Implementation Rules

- 修改代码前先看测试和现有模块边界。
- 新行为优先补测试，再实现。
- 压缩只删除非 protected 的候选消息。
- protected 消息永不删除。
- 所有 remove_candidate 必须有 reasons。
- 避免把真实样本报告、压缩文件提交到项目中。

## Current Known Issue

真实长会话已经可以解析，safety/scorer 也已经能产生可信候选。当前主要问题：

- `analyze` 输出完整 JSON，真实文件下不适合人工查看。
- Phase 0 还缺 5 个多样本验证和人工标注。
- `latest` / `sessions` / `doctor` 尚未实现。
