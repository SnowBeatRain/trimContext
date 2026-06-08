## Context

当前 `parseClaudeCodeJsonl` 将每条非空 JSONL 行解析为 `NormalizedMessage`，并保留 `raw` 和 `rawLine`。`flattenContent` 已支持 tool_use/tool_result block 的基本展开。

`docs/work/trimctx-integration-guide.md` 提到的真实边界包括：

- `isMeta=true` skill 注入内容不应作为普通 user 消息；当前实现保留为 system metadata，更符合保守安全原则。
- tool_result content 可能是 string 或 list。
- assistant 同一 `message.id` 可能先出现流式开始帧，后出现带 `usage` 的最终帧。
- `away_summary` 表示 Claude 已经 compact，应供 reporter 检测。

## Goals / Non-Goals

**Goals:**

- 用 sanitized fixture 锁定这些边界。
- 只在测试暴露缺口时做最小 parser 修改。
- 保留审计字段 `raw` 和 `rawLine`。

**Non-Goals:**

- 不接入真实 transcript。
- 不重写 parser 架构。
- 不改变 report schema。

## Decisions

### Decision 1: 测试先行

先添加 `tests/fixtures/claude-code-edge-cases.jsonl` 和 parser 测试。测试应明确期望：

- `isMeta=true` 输出为 system metadata，并带 `[isMeta]` 标记。
- tool_result string/list 都能展开。
- 同 `message.id` 的 streaming frame 去重，并用带 `usage` 的最终帧替换开始帧。
- away_summary raw 保留。

### Decision 2: 最小 parser 修正

如果当前 parser 已满足某项行为，只保留测试；如果不满足，只在 `parseLine` 或 `flattenContent` 局部修正。

## Approach

1. 创建 fixture，包含所有边界行。
2. 在 `tests/parser.claude-code-jsonl.test.ts` 中新增测试。
3. 运行测试确认失败点。
4. 最小修改 parser。
5. 运行 parser 测试、全量测试和 build。

## Verification

- `npx.cmd vitest run tests/parser.claude-code-jsonl.test.ts`
- `npm.cmd test`
- `npm.cmd run build`
