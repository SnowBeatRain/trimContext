# trimctx × context-rot-analyzer 集成指南

> 基于真实 JSONL 样本分析（353 行，570 万 input tokens）撰写，针对你的实际数据结构。

---

## 一、先搞清楚：你的 JSONL 长什么样

真实文件里有 **9 种行类型**，只有其中 2 种是你要分析的：

```
353 行总计
├── assistant        131 行  ← 需要分析
├── user             109 行  ← 需要分析
├── file-history-snapshot  42 行  ← 跳过（元数据）
├── permission-mode   26 行  ← 跳过（元数据）
├── last-prompt       24 行  ← 跳过（元数据）
├── attachment        11 行  ← 跳过（技能加载记录）
├── system             8 行  ← 跳过（turn_duration、away_summary 等）
├── queue-operation    2 行  ← 跳过
└── (isMeta=true)      2 行  ← 跳过（skill 注入内容）
```

user 消息里的 content 有两种格式：
- `string`（普通用户输入，6 条）
- `list`（含 tool_result block，101 条）—— 这是最大的 token 来源

assistant 消息里：
- `text` block（32 条）—— 正常回复
- `tool_use` block（101 条）—— 工具调用（Read/Write/Bash/Skill 等）

---

## 二、解析器需要处理的关键特殊情况

### 1. isMeta=true 的消息要过滤掉

```jsonc
// isMeta=true 的 user 消息是 skill 注入的系统内容，不是真实用户输入
// 特征：type=user + isMeta=true + content 是超长 skill 文档
{ "type": "user", "isMeta": true, ... }  // ← 跳过
```

### 2. tool_result content 可能是 string 或 list

```typescript
// 真实数据里 tool_result.content 全是 string
// 但要兼容 list 格式（其他来源可能有）
type ToolResultContent = string | Array<{ type: string; text?: string }>;

function extractToolResultText(content: ToolResultContent): string {
  if (typeof content === 'string') return content;
  return content.map(b => b.text ?? '').join('\n');
}
```

### 3. 一条 assistant JSONL 行可能拆成两条

```jsonc
// 同一个 message.id，第一条 output_tokens=0（流式开始）
{ "uuid": "000fe06d", "message": { "id": "cht000be44c@...", "usage": { "output_tokens": 0 } } }
// 第二条有实际 usage（流式结束）
{ "uuid": "000fe06d-2", "message": { "id": "cht000be44c@...", "usage": { "output_tokens": 68 } } }
// 处理方式：按 message.id 去重，保留有 output_tokens 的那条
```

### 4. token 字段在哪里

```typescript
// assistant 消息：message.usage.input_tokens + output_tokens
// user 消息：没有 token 字段，需要估算（content 字符数 / 4）
const tokens = msg.type === 'assistant'
  ? (msg.message?.usage?.input_tokens ?? 0) + (msg.message?.usage?.output_tokens ?? 0)
  : Math.ceil(extractText(msg).length / 4);
```

---

## 三、解析器实现（直接可用）

把这个文件放到你项目的 `src/parser/claudeCodeParser.ts`：

```typescript
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { NormalizedMessage } from '../types.js'; // 你现有的类型

// ── 过滤：这些行类型直接跳过 ────────────────────────────────────────────────
const SKIP_TYPES = new Set([
  'file-history-snapshot',
  'permission-mode',
  'last-prompt',
  'attachment',
  'queue-operation',
]);

// system 行里只保留真正有用的（过滤 turn_duration 等）
const KEEP_SYSTEM_SUBTYPES = new Set<string>([]); // 目前全跳过

export async function parseClaudeCodeJSONL(filePath: string): Promise<NormalizedMessage[]> {
  const messages: NormalizedMessage[] = [];
  const seenMessageIds = new Set<string>(); // 去重流式分片

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let index = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // 跳过损坏行
    }

    const type = record.type as string;

    // ── 跳过无用行 ──────────────────────────────────────────────────────────
    if (SKIP_TYPES.has(type)) continue;
    if (type === 'system') {
      const subtype = record.subtype as string | undefined;
      if (!subtype || !KEEP_SYSTEM_SUBTYPES.has(subtype)) continue;
    }
    // isMeta=true 是 skill 注入内容，不是真实对话
    if (record.isMeta === true) continue;

    // ── 处理 assistant ───────────────────────────────────────────────────────
    if (type === 'assistant') {
      const msg = record.message as Record<string, unknown>;
      if (!msg) continue;

      const msgId = msg.id as string | undefined;

      // 去重：同一 message.id 只保留有 output_tokens 的
      if (msgId) {
        const usage = msg.usage as Record<string, number> | undefined;
        const outTokens = usage?.output_tokens ?? 0;
        const inTokens = usage?.input_tokens ?? 0;
        if (outTokens === 0 && inTokens === 0) continue; // 流式开始帧，跳过
        if (seenMessageIds.has(msgId)) continue;
        seenMessageIds.add(msgId);
      }

      const content = msg.content as unknown[];
      const textBlocks = content?.filter((b: unknown) => (b as Record<string,unknown>).type === 'text') ?? [];
      const toolUseBlocks = content?.filter((b: unknown) => (b as Record<string,unknown>).type === 'tool_use') ?? [];

      const usage = msg.usage as Record<string, number> | undefined;
      const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);

      if (toolUseBlocks.length > 0) {
        // 每个 tool_use 生成一条规范化消息
        for (const block of toolUseBlocks) {
          const b = block as Record<string, unknown>;
          messages.push({
            id: record.uuid as string,
            index: index++,
            role: 'assistant',
            content: JSON.stringify(b.input ?? ''),
            timestamp: record.timestamp as string,
            toolUseId: b.id as string,
            toolName: b.name as string,
            isToolUse: true,
            tokens: Math.ceil(tokens / toolUseBlocks.length),
          });
        }
      } else {
        // 普通文本回复
        const text = textBlocks
          .map((b) => ((b as Record<string,unknown>).text as string) ?? '')
          .join('\n');
        if (!text.trim()) continue;

        messages.push({
          id: record.uuid as string,
          index: index++,
          role: 'assistant',
          content: text,
          timestamp: record.timestamp as string,
          tokens,
        });
      }
    }

    // ── 处理 user ────────────────────────────────────────────────────────────
    else if (type === 'user') {
      const msg = record.message as Record<string, unknown>;
      if (!msg) continue;

      const rawContent = msg.content;

      if (typeof rawContent === 'string') {
        // 普通用户输入
        if (!rawContent.trim()) continue;
        messages.push({
          id: record.uuid as string,
          index: index++,
          role: 'user',
          content: rawContent,
          timestamp: record.timestamp as string,
          tokens: Math.ceil(rawContent.length / 4),
        });
      } else if (Array.isArray(rawContent)) {
        // 可能包含 tool_result
        for (const block of rawContent) {
          const b = block as Record<string, unknown>;

          if (b.type === 'tool_result') {
            const rawText = b.content;
            const text = typeof rawText === 'string'
              ? rawText
              : Array.isArray(rawText)
                ? rawText.map((x: unknown) => ((x as Record<string,unknown>).text ?? '')).join('\n')
                : '';
            if (!text.trim()) continue;

            messages.push({
              id: record.uuid as string,
              index: index++,
              role: 'tool',
              content: text,
              timestamp: record.timestamp as string,
              toolUseId: b.tool_use_id as string,
              isToolResult: true,
              tokens: Math.ceil(text.length / 4),
            });
          } else if (b.type === 'text') {
            const text = (b.text as string) ?? '';
            if (!text.trim()) continue;
            messages.push({
              id: record.uuid as string,
              index: index++,
              role: 'user',
              content: text,
              timestamp: record.timestamp as string,
              tokens: Math.ceil(text.length / 4),
            });
          }
        }
      }
    }
  }

  // 最终按 index 排序（JSONL 本身是时间顺序，通常已有序）
  return messages.sort((a, b) => a.index - b.index);
}
```

---

## 四、接入分析器（你的 CLI 里怎么写）

```typescript
// src/commands/analyze.ts（示意，对应你现有的 analyze 命令）

import { parseClaudeCodeJSONL } from '../parser/claudeCodeParser.js';
import { analyzeSession, printReport, saveReport } from '../../context-rot-analyzer/src/index.js';
// 或者 copy 到项目内：import { analyzeSession } from '../analyzer/index.js';

export async function runAnalyze(filePath: string, opts: { json?: boolean; output?: string }) {
  // 1. 解析
  const messages = await parseClaudeCodeJSONL(filePath);

  // 2. 分析
  const report = analyzeSession(messages, filePath);

  // 3. 输出
  if (opts.json) {
    // analyze --json → 完整 JSON（你的 PLAN.md 要求的 analyze --json）
    console.log(JSON.stringify(report, null, 2));
  } else {
    // analyze → 短摘要（你的 PLAN.md 要求的默认短摘要）
    printReport(report);
  }

  // 4. 文件留存（对应你的 report 命令）
  if (opts.output) {
    saveReport(report, opts.output);
  }
}
```

---

## 五、真实样本的预期输出

根据实际数据（353 行，570 万 tokens），跑完后你应该看到：

```
─────────────────────────────────────────────────────────
  Context Rot Analyzer
  5c574dba-0f62-406b-980b-a098da258ddd.jsonl
─────────────────────────────────────────────────────────

  Session Overview

    Messages         ~240  （过滤元数据后）
    Total Tokens     ~5.7M
    Protected        ~80   （system + 近期 10 条 + 架构决策）
    Compress         ~60   （大型 Read 工具结果：skill 文档）
    Remove           ~20   （未被引用的 tool_result）
    Keep             ~80

  Estimated Savings

    Tokens saved     ~2-3M
    Savings          ~40-50%
```

**最值钱的压缩目标**：

你的对话里有大量 `Read` 工具调用，读取的是 skill 文档（`references/webview.md` 等），
这些 tool_result 内容极长（每条数千 token），而且大多数只用于一次性参考，
后续几乎没有被重复引用 → **orphan_tool 分数高，是最大的压缩来源。**

---

## 六、字段映射速查表

| 你的 JSONL 字段 | NormalizedMessage 字段 | 说明 |
|---|---|---|
| `uuid` | `id` | 消息唯一 ID |
| 行序号（解析时计数） | `index` | 消息顺序 |
| `message.role` | `role` | user/assistant |
| `message.content[].text` | `content` | 文本内容 |
| `message.usage.input_tokens + output_tokens` | `tokens` | assistant 用实际值 |
| `content.length / 4` | `tokens` | user/tool 估算值 |
| `content[].id`（tool_use block） | `toolUseId` | 工具调用 ID |
| `content[].name`（tool_use block） | `toolName` | 工具名：Read/Write/Bash |
| `tool_use_id`（tool_result block） | `toolUseId` | 对应的 use ID |
| `timestamp` | `timestamp` | ISO 时间戳 |

---

## 七、需要注意的 3 个坑

**坑 1：Read 工具结果 token 估算偏低**

skill 文档内容很长，`content.length / 4` 会严重低估。
建议对 `toolName === 'Read'` 的结果用 `content.length / 3` 估算。

**坑 2：同一 uuid 可能对应多个 content block**

一条 user 行可能同时含 tool_result + text block，
需要拆成多条 NormalizedMessage（解析器已处理）。

**坑 3：`away_summary` 是 Claude 自动压缩的摘要**

```jsonc
{ "type": "system", "subtype": "away_summary", ... }
```
这条记录说明 Claude 已经自动压缩过一次了。
你可以用它来判断：**这个会话之前已经被压缩过**，需要在报告里标注。

---

## 八、下一步优先级（对应你的 PLAN.md v0.2 目标）

按你当前主线排序：

```
P0（本周）
  ✅ 解析器能正确处理真实 JSONL
  ✅ analyze 默认短摘要 / --json 完整输出
  ⬜ top reasons 字段（report.summary.remove[].reason 已有，需要 CLI 展示）

P1（下周）
  ⬜ 5 个多样本验证（把 5 个不同的真实 .jsonl 跑一遍，人工看结果）
  ⬜ sessions / latest 命令（扫描 ~/.claude/projects/ 找所有 .jsonl）
  ⬜ doctor 命令（检查环境：Node 版本、文件权限、样本数量）

P2（之后）
  ⬜ compress 命令（把 remove_candidate 过滤掉，输出新 .jsonl）
  ⬜ away_summary 检测（报告里标注"已被 Claude 压缩过"）
```

---

> 解析器是唯一需要针对你真实数据写的部分，其余（评分、决策、报告）直接用 context-rot-analyzer 模块即可。
