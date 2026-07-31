# 完整会话 Export 命令设计

## 目标与可研结论

新增 `trimctx export [file] -o <conversation.md>`，把 Claude Code、OpenAI、Codex/Hermes JSONL 中现有 parser 识别的全部规范化消息按源顺序导出为 Markdown。技术可行性高：格式检测、三种 parser、输入身份复查和原子写入均已存在；新增范围主要是纯 formatter、薄 CLI 命令、客户端资产和发布测试。

该命令不改变 `report.md`。健康报告继续只展示脱敏限长证据，transcript 则是默认不脱敏的私密全文产物。

## 方案比较

1. **独立 export 命令（采用）**：语义和隐私边界清楚，直接复用 parser，不耦合评分；代价是公开命令由五个增至六个，需要同步发布合同。
2. **扩展 report 模式（拒绝）**：文件更少，但会让同一个命令同时承担脱敏审查和未脱敏全文，破坏稳定契约。
3. **原始 JSONL 包装成 Markdown（拒绝）**：接近字节无损，但用户仍需阅读 JSON，不能形成可用的对话文档。

## 架构

```text
JSONL -> parseJsonl -> NormalizedMessage[] -> transcript Markdown formatter
                                             -> atomic safe output
```

formatter 使用按源顺序的事件账本，不猜测 turn，不移动 system/tool/compact 事件。正文使用动态长度反引号或波浪号围栏，既不改变全文，也不允许原内容破坏外层 Markdown。文档记录格式版本、输入路径、SHA-256、source、session ID、消息数和逐消息审计元数据。

省略 `[file]` 时只读取严格 hook-bound 当前窗口；不使用 latest fallback。`-o` 必填且只接受 `.md`，输入文件或别名永不允许作为输出。

## 真实边界

“全部”指 `parseJsonl` 返回的全部 `NormalizedMessage`，不是 raw JSONL 逐行备份。Claude 内容块可能合并、流式重复帧按 parser 去重；Codex 加密 reasoning、event/turn 元数据和未知 subtype 按既有 parser 规则省略。产物不脱敏，可能包含系统指令、密钥、路径、源码和工具输出，分享前必须审查。

## 模块

- `src/core/transcript-markdown.ts`：纯格式化、围栏选择、确定性输出。
- `src/commands/export.ts`：输入绑定、hash、parser、扩展名与安全原子写入。
- `src/commands/index.ts`：注册第六个公开命令。
- `plugins/trimctx/commands/trimctx/export.md`：Claude 当前窗口薄封装。
- `codex/skills/trimctx/SKILL.md`：显式文件工作流，不宣称当前窗口绑定。

## 错误与安全

无消息、不支持格式、非法 JSONL、非 `.md` 输出、同文件/别名、无可信绑定、输入竞争变化和写入失败都以非零状态结束。解析和渲染完成前不替换目标；正文不进入 stdout 或错误日志；不修改原始 transcript。

## 测试与发布门

- 纯 formatter 覆盖所有角色、顺序、可选元数据、空正文、Unicode、HTML、Markdown 和冲突围栏。
- CLI 覆盖三种 fixture、当前绑定、扩展名、输入 hash、同路径、解析失败保留目标和确定性。
- packed-install smoke 使用安装后的二进制实际生成 Markdown。
- 最终运行聚焦测试、`npm test`、`npm run build`、`npm run build:publish`、`npm pack --dry-run --json`、真实样本只读验证、`git diff --check` 和 OpenSpec strict validate。

详细 requirements、数据格式和风险以 `openspec/changes/add-conversation-transcript-command/` 为权威工件。
