## Why

`docs/work/integration-value-assessment.md` 将真实 JSONL 边界 fixture 列为 P0。`docs/work/trimctx-integration-guide.md` 指出 Claude Code JSONL 中存在 metadata 行、`isMeta` skill 注入、tool_result string/list、assistant 流式分片和 `away_summary` 等边界。

当前 parser 已能处理许多真实样本，但需要把这些边界转成可重复测试，防止后续回归。

## What Changes

- 添加覆盖 Claude Code 真实 JSONL 边界的测试 fixture。
- 补充 parser 测试，明确 metadata、isMeta、tool_result list/string、assistant 流式分片、away_summary 的期望行为。
- 如测试暴露缺口，以最小实现修正 parser。

## Core Features

- 覆盖 `isMeta=true` skill 注入内容作为 system metadata 保留并受保护。
- 覆盖 tool_result `content` 为 string 和 list 两种格式。
- 覆盖 assistant 流式分片去重或跳过空 usage 帧。
- 覆盖 `away_summary` compact signal 保留为可报告 metadata。
- 保留原始 `rawLine`/`raw` 审计信息。

## Capabilities

### New Capabilities
- `claude-code-parser-edge-fixtures`：用 sanitized fixtures 锁定 Claude Code JSONL 边界行为。

### Modified Capabilities
- None

## Impact

- `tests/fixtures/claude-code-edge-cases.jsonl`
- `tests/parser.claude-code-jsonl.test.ts`
- 如有缺口，可能修改 `src/adapters/claude-code-jsonl.ts`

## Non-Goals

- 不引入真实私有 transcript。
- 不改 OpenAI parser。
- 不改变 compressor 行为。
- 不实现 session discovery。

## Open Questions

- None
