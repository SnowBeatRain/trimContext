# trimctx 最终目标方案

## 一句话定位

trimctx 是一个本地 AI 长对话上下文精简工具：安装一次，在 AI 里一条命令分析当前会话，识别过时、重复、低价值、未引用内容，并生成安全压缩副本。

## 用户体验目标

最终用户不应该手动找 `.jsonl` 文件，也不应该打开额外程序。

理想体验：

```bash
npx trimctx@latest install claude-code
```

然后在 Claude Code 中输入：

```text
/trimctx
```

输出当前会话摘要：

```text
总消息: 186
总 tokens: 142,300
可删除候选: 37
预计节省: 28,400 tokens
节省比例: 19.9%

建议:
- /trimctx report 查看完整报告
- /trimctx compress 生成安全压缩副本
```

## 产品分层

1. Core Engine
   - parser
   - tokenizer
   - safety rules
   - scorer
   - reporter
   - compressor

2. CLI
   - `trimctx analyze <file>`
   - `trimctx report <file> -o report.json`
   - `trimctx compress <file> -o output.jsonl`
   - `trimctx latest`
   - `trimctx doctor`

3. AI Integrations
   - `trimctx install claude-code`
   - `/trimctx`
   - `trimctx hook`
   - `trimctx watch`
   - 后续：`install codex`、`install mcp`

核心逻辑必须和 Claude/Codex 解耦，AI 平台只是入口。

## 当前版本路线

项目需求和边界见：`docs/requirements.md`。
使用说明见：`docs/usage.md`。
详细阶段成果、验收标准和开源发布门槛见：`docs/roadmap.md`。
具体执行任务、数据集要求、报告格式和 Phase 0 验收见：`docs/execution-plan.md`。

### v0.1：核心可用

目标：验证本地 CLI 是否能可靠分析真实 Claude Code / OpenAI JSONL。

必须具备：

- 文件分析
- 报告生成
- 安全压缩副本
- parser / tokenizer / safety / scorer / compressor
- 自动化测试

### v0.2：一步安装

目标：用户不用找 JSONL 文件。

新增：

- `trimctx latest`
- `trimctx doctor`
- `trimctx install claude-code`
- `/trimctx`

### v0.3：实时辅助

目标：在 Claude Code 会话中自动提示上下文健康状态。

新增：

- `trimctx hook`
- `trimctx watch`
- `trimctx status`

### v0.4：多 AI 接入

目标：进入 Codex、Claude Desktop、ChatGPT、Cursor 等生态。

新增：

- `trimctx install codex`
- `trimctx install mcp`

## 安全原则

trimctx 的第一原则是：宁可少删，也不要误删。

永远保护：

- system / developer
- 最近 6 轮
- 代码块
- 错误栈
- 文件路径
- shell 命令
- git diff
- 测试失败信息
- 记忆类指令：记住、以后、从现在开始、不要忘记
- 用户明确决策
- 架构/API/schema/配置变更
- 被后续引用的关键 tool result

protected 消息永不删除。

## 当前问题

v0.1 核心已经可运行，但真实长会话验证显示规则过保守：

- protected 比例过高
- tool_use / tool_result 一旦互相引用就大量保护
- 元事件和大块 attachment 尚未单独降权
- `analyze` 输出完整 JSON，真实文件下不适合人工查看

下一步应该先调规则和 CLI 输出，而不是马上做安装器。
