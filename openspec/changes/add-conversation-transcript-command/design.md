## Context

现有三个 adapter 已把 Claude Code、OpenAI 和 Codex/Hermes JSONL 统一成 `NormalizedMessage[]`。该结构保留规范化正文、角色、ID、源行、原始记录、时间戳、session、父消息和工具关联，是新功能最稳定的共享边界。

现有 `analyzeInput` 会继续执行 tokenization、safety、signals、scorer 和 report 构造；`report.md` 只允许脱敏且限长的审查证据；`new-chat` 只提取续接所需的启发式摘要。因此全文 transcript 不能复用这两个 Markdown formatter，也不应进入分析阶段。

格式边界必须如实表达：导出包含 `parseJsonl` 返回的全部规范化消息，不是原始 JSONL 的逐行复制。Claude 内容块可能被合并、流式重复帧会按现有 parser 去重；Codex 加密 reasoning、event/turn 元数据及未知 response subtype 按现有 parser 契约不进入消息数组。

## Goals / Non-Goals

**Goals:**

- 新增第六个公开命令 `trimctx export [file] -o <conversation.md>`，不保留旧命令别名。
- 生成不筛选、不截断、不脱敏的规范化会话事件账本。
- 保留顺序、正文与可用的消息来源元数据。
- 对任意 Markdown、HTML、代码围栏和 Unicode 正文保持外层结构稳定。
- 使用现有输入身份复查和原子写入能力，确保原 transcript 只读。
- 支持显式文件和严格 hook-bound 当前窗口，不做 latest fallback。
- 同步 Claude 插件、Codex skill、双语文档和 packed-install smoke。

**Non-Goals:**

- 不实现 raw JSONL round trip 或恢复能力。
- 不扩展 parser 支持面或改变 parser 当前的去重、角色映射和省略规则。
- 不增加筛选、分页、时间范围、脱敏、总结或其他输出格式。
- 不修改 scorer、threshold、safety、Report v2、new-chat 或 compressor。
- 不提前修改 npm 版本；只记录 `Unreleased` 变更。

## Decisions

### Decision 1: 使用 export 独立命令

采用简短且标准的 `export`，而不是扩展 `report` 或使用更长的 `transcript` 子命令。`report.md` 是健康审查产物，证据必须脱敏且限长；全文内容具有不同的隐私、体积和完整性契约。`export` 符合 CLI 中“将已有数据写入外部文件”的常见动词习惯，也更便于输入和发现；它的范围由命令帮助和输出约束明确收窄为“导出 parser 识别的全部规范化消息到未脱敏 Markdown”，不表示支持任意格式、字段抽取或 raw JSONL 备份。

该公开命令尚未发布，因此直接以 `export` 替换原计划名称，不保留 `transcript` 别名，避免形成永久的重复命令面。

命令签名为：

```text
trimctx export [file] -o <conversation.md>
```

`-o` 必填，只接受大小写不敏感的 `.md`。成功时 stdout 只输出目标、消息数和检测来源，不输出正文。

### Decision 2: 在 parseJsonl 后、analysis 前分支

数据流为：

```text
JSONL bytes
  -> parseJsonl
  -> NormalizedMessage[]
  -> formatTranscriptMarkdown
  -> atomicWriteFileDistinctFromInput
  -> concise completion metadata
```

这样复用已有格式检测和 parser 回归覆盖，同时不让全文导出受 tokenizer、safety 或评分规则变化影响。`AnalysisReport.messages` 不再包含完整 `raw`/tool/parent 信息，也不能作为数据源。

### Decision 3: 使用按源顺序的事件账本

选择事件账本，不按 user turn 猜测分组，也不把 system/tool 移到附录。并行工具调用、compact boundary、system context 和 unknown event 都能保持原时序。

文档结构固定为：

```text
# trimctx Conversation Transcript
privacy and normalization notices
document metadata
## Messages
### Message 1 - User
message metadata
fenced full content
...
```

头部包含 `trimctx.transcript.v1`、source file、SHA-256、source format、session ID（如有）和 message count。每条事件包含 role、ID、source line，以及存在时的 timestamp、parent ID、tool name/use ID/result target。

### Decision 4: 动态选择围栏字符和长度

正文不做 Markdown 转义，因为转义会改变可复制内容。formatter 分别计算正文中最长连续反引号和波浪号，选择所需围栏更短的一种；围栏长度为 `max(3, longestRun + 1)`。正文因此无法提前闭合围栏，Markdown 标题、HTML 和链接都只作为代码文本展示。

元数据使用安全的动态 inline-code span，避免路径、ID 或时间戳中的 Markdown 字符改变结构。formatter 不生成时间或随机值，保证相同路径与输入产生字节一致的结果。

### Decision 5: 全文产物默认私密且不脱敏

“完整”和“默认脱敏”不可同时保证。输出头部明确警告可能包含系统提示、密钥、路径、源码和完整工具结果，分享前必须人工审查；同时说明这是 parser-normalized transcript，不是 raw backup。命令不把正文写到 stdout 或错误日志。

### Decision 6: 文件安全与当前窗口语义沿用最严格边界

命令仿照 `report`：先检查输入/输出不是同一文件，保持输入 `FileHandle` 打开，读取并渲染后调用 `atomicWriteFileDistinctFromInput`。该 helper 在提交前再次核对输入 snapshot 和输出 inode，解析失败或竞争变化都不会替换已有目标。

省略 `[file]` 时调用 `resolveBoundSessionFile()`，校验可读普通文件及可用的 session ID；不调用 `resolveCurrentSessionFile()`，因此不会隐式选择 latest。

### Decision 7: 同步现有客户端集成而不新增安装器

Claude plugin 增加 `/trimctx:export` 薄封装，默认写项目 cwd 的 `conversation.md`，并继承当前窗口绑定和隐私提示。Codex skill 只记录 CLI 用法，不宣称存在 Codex slash command 或经过验证的当前窗口绑定。`init` 继续复制同一个插件/skill 目录，无新安装模式。

## Approach

### Core formatter

新建 `src/core/transcript-markdown.ts`：

```ts
export interface TranscriptMarkdownInput {
  file: string;
  sha256: string;
  messages: readonly NormalizedMessage[];
}

export interface TranscriptMarkdownResult {
  markdown: string;
  source: MessageSource;
  sessionId?: string;
  messageCount: number;
}

export function formatTranscriptMarkdown(
  input: TranscriptMarkdownInput
): TranscriptMarkdownResult;
```

空消息数组抛出明确错误，避免伪造 source format。结果始终以单个换行结尾。

### CLI command

新建 `src/commands/export.ts` 并在 `src/commands/index.ts` 注册。命令负责：解析输入选择、扩展名检查、读取 Buffer、计算 SHA-256、调用 `parseJsonl` 和 formatter、原子写入、输出三行完成摘要；不注册旧 `transcript` 别名。

### Client assets and docs

新增 `plugins/trimctx/commands/trimctx/export.md`，更新 plugin README/`.system` 和 package asset tests。Codex skill、README、双语 usage、requirements、iteration plan、roadmap、execution plan、status、AGENTS 和 Changelog 统一使用六命令表述和同一隐私边界。

## Data Model

新产物格式和内部输入模型见 `data-model.md`。没有数据库、JSON schema、配置或迁移；`trimctx.transcript.v1` 只版本化 Markdown 文档结构。

## Risks

- **私密内容泄漏：** 默认不脱敏以满足全文契约；通过头部警告、客户端提示、无正文 stdout 和文档说明缓解。
- **Markdown 注入或结构破坏：** 正文使用动态围栏，元数据使用安全 code span，并以恶意 Markdown/HTML fixture 覆盖。
- **“全部”表述过度：** 所有文档统一写“全部规范化消息”，显式列出 parser 当前省略和合并边界。
- **超大会话内存与文件体积：** 当前 parser 已整文件读取，本次不额外复制 raw JSON；Markdown 大小可能接近输入，文档提示本地产物。流式重构不在本次范围。
- **公开命令面回归：** CLI surface 和 packed fresh-install 测试锁定六个公开命令，其余五个契约保持原测试覆盖。
- **并发输入变化：** 复用输入 snapshot 复查和原子提交，已有目标在失败时保持不变。
- **OpenSpec 历史冲突：** 不归档仍含旧 `current` 语义的 `remove-resume-command`；本 change 只验证自身，不同步过时 delta。

## Verification

- TDD RED/GREEN：`tests/transcript-markdown.test.ts`、`tests/cli-export.test.ts`。
- 回归：`tests/cli-surface.test.ts`、`tests/cli-commands.test.ts`、`tests/package-contents.test.ts` 和三个 parser test。
- 静态与发布：`npm run build`、`npm run build:publish`、`npm pack --dry-run --json`、`git diff --check`、`openspec validate add-conversation-transcript-command --strict`。
- 全量：`npm test`。
- CLI fixtures：Claude Code、OpenAI、Codex sanitized fixtures。
- 真实样本：只读指定 Claude JSONL，输出到 `tmp-real-validation/`；比较输入前后 SHA-256，检查消息数、首尾事件和 Markdown 围栏。
