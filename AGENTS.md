# trimctx Agent Instructions

## Language

中文优先。除非用户明确要求英文，否则回复、计划、状态更新、文档说明都使用简体中文。

## Project Goal

trimctx 是一个本地 AI 长对话上下文精简工具。目标是读取 Claude Code / OpenAI / Codex 长对话 JSONL，识别过时、重复、低价值、未引用内容，输出可审计报告，并生成安全压缩副本。

最终产品体验是：用户安装一次后，在 AI 内一条命令即可分析当前会话，不需要手动寻找 `.jsonl` 文件。

## Current Mainline

先阅读：

- `docs/dev/iteration-plan.md`
- `docs/dev/requirements.md`
- `docs/user/usage.md`
- `docs/dev/roadmap.md`
- `docs/dev/execution-plan.md`
- `docs/dev/status-and-next-steps.md`

当前主线不是做 Web UI、MCP 或新安装器，而是稳定已验证可行的 v0.2 CLI 和现有集成：

- 保持 `analyze` 短摘要、`report` 完整 JSON 和 `analyze --json` 的现有契约。
- 将 `export` 作为经批准的有限例外：只导出 parser 识别的全部规范化消息，不改变分析、评分或压缩行为。
- 修复 Windows/package 发布质量门并保持 npm fresh-install smoke。
- 明确 SessionStart/Stop hooks 的写入范围，原始 transcript 始终只读。
- 渐进拆分 CLI、pipeline、session discovery 和共享工具，不调整 scorer/threshold。
- `latest` / `sessions` / `doctor` 仍不作为近期主线。
- 保持“宁可少删，也不要误删”的安全原则。

项目负责人已确认现有工作流可行，因此样本数量不阻塞本轮稳定化与重构；这不等同于宣称 `phase0_trust` 已锁定。若要对外承诺无需人工审查的压缩安全性，仍需满足 `docs/dev/phase0/phase0-plan.md` 的正式发布门槛。

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
# 核心分析命令
npx tsx src/cli.ts analyze <file>
npx tsx src/cli.ts report <file> -o report.json
npx tsx src/cli.ts export <file> -o conversation.md
npx tsx src/cli.ts compress <file> -o output.jsonl

# 会话定位选项
npx tsx src/cli.ts analyze --select                # 交互选择本地会话
npx tsx src/cli.ts analyze --latest                # 显式分析最近的 Claude Code 或 Codex 会话
npx tsx src/cli.ts analyze --latest --source claude
npx tsx src/cli.ts analyze --latest --source codex

# 续接命令
npx tsx src/cli.ts new-chat <file>

# 可信当前窗口绑定可省略 export 输入文件；不回退 latest
npx tsx src/cli.ts export -o conversation.md

# AI 客户端资产安装
npx tsx src/cli.ts init                       # 安装 Claude Code 插件 + Codex skill
npx tsx src/cli.ts init --client claude       # 只安装 Claude Code
npx tsx src/cli.ts init --dry-run             # 预览安装路径
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

真实工作流已经由项目负责人确认可行。当前主要问题：

- Windows packed-install 测试必须使用平台正确的 npm 全局目录。
- 六命令公开面和 Claude/Codex export 资产必须保持 packed-install smoke 通过。
- CLI 入口和集成代码职责过多，需要在行为测试保护下渐进拆分。
- hooks 文档必须明确 Stop hook 可能更新 `.claude/CLAUDE.md` 的受管区块。
