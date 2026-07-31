## 1. 文档格式

Markdown 产物的逻辑版本为 `trimctx.transcript.v1`。它是可阅读的规范化事件账本，不是 JSONL 的 round-trip 格式。

固定顶层顺序：

1. 标题 `# trimctx Conversation Transcript`
2. 未脱敏隐私警告
3. parser normalization 边界说明
4. 文档元数据
5. `## Messages`
6. 零到多条消息事件（命令层实际要求至少一条）

## 2. 文档元数据

| 字段 | 必填 | 来源 | 规则 |
| --- | --- | --- | --- |
| `format_version` | 是 | 常量 | 固定为 `trimctx.transcript.v1` |
| `source_file` | 是 | CLI 输入 | 保留调用时路径文本，不解析成输出路径 |
| `source_sha256` | 是 | 原始输入 bytes | 64 位小写十六进制 |
| `source_format` | 是 | 第一条 `NormalizedMessage.source` | 三种已支持 source 之一 |
| `session_id` | 否 | 第一条带 session ID 的消息 | 不推测缺失值 |
| `message_count` | 是 | `messages.length` | 大于 0 |

不记录生成时间、输出路径或随机标识，以保持确定性。

## 3. 消息事件

每个事件按数组索引从 1 编号：

```ts
interface TranscriptEventView {
  sequence: number;
  role: MessageRole;
  id: string;
  sourceLine: number;
  content: string;
  timestamp?: string;
  parentId?: string;
  toolName?: string;
  toolUseId?: string;
  toolResultFor?: string;
}
```

`content` 来自 `NormalizedMessage.content`，包括空字符串，不应用 `trim()`、redaction、summary 或长度限制。可选字段不存在时不渲染占位符。

## 4. 围栏编码

对每条 `content`：

1. 计算最长连续反引号长度 `backticks`。
2. 计算最长连续波浪号长度 `tildes`。
3. 选择 `max(3, backticks + 1)` 与 `max(3, tildes + 1)` 中较短的围栏；相同则选反引号。
4. 以 `<fence>text` 开始，正文后补充 Markdown 结构所需的换行，再以同一 fence 结束。

补充的结构换行不属于原始正文；正文自身的所有 code point 仍连续、完整地出现在围栏内部。

## 5. 兼容与迁移

本次没有旧 transcript Markdown 格式需要迁移。未来若改变顶层章节、字段语义或正文编码，必须发布新的逻辑版本；增加不影响现有读取的说明文本仍需通过确定性和 snapshot-like 结构测试。
