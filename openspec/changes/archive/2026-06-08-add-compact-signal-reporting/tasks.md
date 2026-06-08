## 1. Report warning

- [x] 1.1 [CAP:compact-signal-reporting] 在 `tests/reporter.test.ts` 添加失败测试，覆盖 `away_summary` raw record 会进入 report warnings。
- [x] 1.2 [CAP:compact-signal-reporting] 修改 `src/core/reporter.ts`，从 `NormalizedMessage.raw` 收集 compact/away_summary warning。

## 2. Verify

- [x] 2.1 运行 `node --test` 或项目测试命令验证 reporter 测试。
- [x] 2.2 运行 `npm test`。
- [x] 2.3 运行 `npm run build`。
