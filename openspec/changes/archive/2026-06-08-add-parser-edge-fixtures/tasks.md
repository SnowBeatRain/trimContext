## 1. Fixtures and parser behavior

- [x] 1.1 [CAP:claude-code-parser-edge-fixtures] 新增 `tests/fixtures/claude-code-edge-cases.jsonl`，覆盖 isMeta system metadata、tool_result string/list、assistant streaming frame、away_summary。
- [x] 1.2 [CAP:claude-code-parser-edge-fixtures] 在 `tests/parser.claude-code-jsonl.test.ts` 添加失败测试，锁定这些边界行为。
- [x] 1.3 [CAP:claude-code-parser-edge-fixtures] 如测试失败，最小修改 `src/adapters/claude-code-jsonl.ts` 或 `src/adapters/content.ts`。

## 2. Verify

- [x] 2.1 运行 `npx.cmd vitest run tests/parser.claude-code-jsonl.test.ts`。
- [x] 2.2 运行 `npm.cmd test`。
- [x] 2.3 运行 `npm.cmd run build`。
