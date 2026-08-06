# Claude Stop `last_assistant_message` 完整性设计

## 背景

Claude Code 的 Stop hook stdin 可以提供 `last_assistant_message`。官方语义明确指出，部分版本触发 Stop 时，transcript 不保证已经包含刚完成的最终 assistant 回复。trimctx 当前只分析 `transcript_path`，并把该 stdin 字段当成未知字段忽略。

已用合成会话稳定复现：transcript 本体约 49,184 tokens，stdin 再提供约 2,000 tokens 的最终 assistant 回复时，当前 Stop hook 仍报告低压力并跳过 `.claude/CLAUDE.md` 更新；把同一回复落入 transcript 后，完整分析结果为中压力，并能提取最终回复中的下一步。这说明问题位于 Stop 输入快照边界，不是 scorer 或阈值错误。

## 目标

- Stop hook 分析必须覆盖刚完成的 `last_assistant_message`，即使 transcript 尚未刷新。
- transcript 已经包含同一最终 assistant 回复时，不重复计数或制造 duplicate/supersession 信号。
- 补全只存在于当前 Stop 进程内存，不写回 transcript。
- 保持 `analyze`、`report`、`export`、`compress`、`new-chat` 及默认命令的输入和输出契约不变。
- 保持原始 transcript 只读以及 `.claude/CLAUDE.md` 受管区块写入范围不变。

## 非目标

- 不等待或轮询 Claude Code 刷新 transcript。
- 不改变 scorer、recent window、tokenizer 或压力阈值。
- 不把 Stop 临时消息暴露给 `export`、压缩副本或持久化 Report v2。
- 不新增 CLI 选项、公开命令或 hook 输出协议。
- 不依据 `stop_hook_active` 跳过无阻塞副作用的 trimctx Stop hook。

## 方案比较

### 方案 A：Stop 专用内存补全（采用）

读取 transcript 后，在规范化消息数组末尾按需补一条临时 assistant 消息，再执行现有 tokenization、安全规则、信号、评分、报告和 resume 流程。优点是分析快照完整、行为确定、无需修改原文件，并且仅影响 Stop 集成。风险是必须保守去重并清楚标识虚拟来源；这些风险可通过纯边界测试和真实 CLI 进程回归覆盖。

### 方案 B：等待 transcript 刷新后重读

轮询文件大小或最新 assistant 内容，等待最终回复落盘。该方案引入延迟和竞争条件，无法区分未刷新、重复流式帧和内容本来相同的合法回复，也没有 Claude Code 提供的完成同步点，因此不采用。

### 方案 C：保持现状并记录限制

不读取 `last_assistant_message`，仅在文档中说明 Stop 状态可能落后一轮。该方案保留已证实的错误压力判断和过期 CLAUDE.md 状态，与自动维护上下文状态的目标冲突，因此不采用。

## 架构与职责

### `src/core/hook-input.ts`

`HookInput` 新增可选 `last_assistant_message?: string`，沿用现有运行时边界：字段缺失时返回 `undefined`，存在但不是字符串时在任何文件读写前失败。未知 Claude 字段继续允许并忽略，错误不得回显 stdin 内容。

### `src/core/hook-analysis.ts`

新增 Stop 专用分析边界，职责限定为：

1. 只读读取指定 transcript。
2. 使用现有 parser 得到 `NormalizedMessage[]`。
3. 保守判断是否需要补入 `last_assistant_message`。
4. 使用现有 `analyzeMessages` 和 `createReport` 生成仅供当前 Stop hook 使用的报告。

该模块不写文件，不修改输入数组，不改变任何分析选项。`src/core/hook.ts` 只把已验证的字段传给该边界，随后保留现有压力判断和受管区块更新逻辑。

## 补全与去重规则

1. 字段缺失或只含空白时，不补消息。
2. 从已解析消息末尾向前查找最新 assistant 消息；尾部的 system/metadata 记录不阻断查找。
3. 判等只统一 `CRLF`/单独 `CR` 为 `LF` 并去除整段首尾空白，保留大小写、内部空白和所有正文字符。
4. 最新 assistant 与 stdin 文本判等后完全相同时，不补消息。
5. 即使更早的 assistant 内容相同，只要最新 assistant 不相同，仍补消息；重复回答可能是当前回合的真实输出，不能按全局内容误判为已落盘。
6. 需要补全时追加一条 `role: "assistant"` 的临时 `NormalizedMessage`。ID 使用 trimctx 保留前缀，source 继承当前 transcript，source line 复用当前最后一个已解析 source line，session ID 继承最近可用值；不伪造 timestamp、tool link 或持久化行。
7. 临时消息位于数组末尾，因此沿用现有 recent window 成为 protected。任何候选删除逻辑都不会接触它，而且它从未进入 compressor。

复用最后 source line 是有意选择：该字段表示消息来自当前已读 transcript 边界后的 Stop 快照，而不是声称磁盘上存在一个新的 JSONL 行。Claude/OpenAI 规范化消息本来也不要求 source line 唯一。

## 数据流

```text
Claude Stop stdin
  -> 运行时字段校验
  -> 只读 transcript + 现有 parser
  -> 最新 assistant 保守判等
  -> 按需追加内存消息
  -> 现有完整分析/报告流水线
  -> 现有压力判断
  -> 仅更新 .claude/CLAUDE.md 受管区块
```

SessionStart 继续只消费 transcript/session 绑定字段，不使用最终 assistant 内容。`analyzeFile` 和 `analyzeInput` 不增加补全参数，避免公共分析调用误用 hook 专属数据。

## 错误处理与安全

- 非字符串 `last_assistant_message` 在读取 transcript、环境文件或 CLAUDE.md 前失败，错误只包含字段名和期望类型。
- malformed JSON 继续使用现有固定错误，不回显最终回复。
- transcript 读取或解析失败时保持现有失败关闭行为。
- 补全内容不直接打印到 stdout/stderr，也不直接写入 CLAUDE.md；只有现有经过脱敏和长度限制的状态格式化逻辑可以持久化其派生统计。
- dry-run 仍执行完整分析但不写 CLAUDE.md；两种模式都不修改 transcript。

## 测试策略

- 输入边界测试：接受字符串字段；拒绝数字、null、数组或对象。
- Stop 分析单元测试：缺失/空白不补、最新 assistant 完全匹配时去重、换行/首尾空白等价时去重、仅更早消息匹配时仍补。
- 分析链路测试：补入消息增加总数和 token，成为 protected，并参与 `resume.nextSteps`；去重时结果与 transcript 自身一致。
- CLI 进程回归：构造 50k 阈值边界 transcript，验证补全前低压力、传入最终回复后 Stop 为中压力并创建受管区块，同时 transcript SHA-256 不变。
- 副作用回归：非字符串字段必须在创建 `.claude` 或写任何环境文件前失败。
- 完成后运行聚焦测试、全量测试、TypeScript build、npm package contents/fresh-install smoke 和差异检查。

## 成功标准

- Stop hook 在 transcript 未含最终回复时分析完整当前回合。
- transcript 已含同一最终回复时不会重复计数。
- 公共命令和 scorer/threshold 契约不变。
- 原始 transcript 在成功、dry-run 和输入失败路径上哈希保持不变。
- 全量测试、构建和 package smoke 通过。
