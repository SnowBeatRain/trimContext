# Claude Stop `last_assistant_message` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude Stop hook 在 transcript 尚未落入最终 assistant 回复时，用 stdin 的 `last_assistant_message` 完成只读内存分析，并在已落盘时保守去重。

**Architecture:** 在现有 hook stdin 运行时边界增加字符串字段校验；新增 Stop 专用分析模块，组合现有 parser、analyzer 和 reporter，并只在最新 assistant 不等价时追加临时规范化消息。公共 pipeline、评分阈值、压缩和导出路径保持不变。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、Commander、现有 Claude JSONL parser/report pipeline

---

### Task 1: 扩展 hook stdin 运行时边界

**Files:**
- Modify: `tests/hook-input.test.ts`
- Modify: `src/core/hook-input.ts`

- [x] **Step 1: 写接受与拒绝 `last_assistant_message` 的失败测试**

在已知字段用例中加入：

```ts
last_assistant_message: "Final assistant reply"
```

并期望解析结果保留该字段；在无效形状表中加入：

```ts
{
  raw: JSON.stringify({ last_assistant_message: null }),
  error: "Claude hook input last_assistant_message must be a string"
}
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/hook-input.test.ts`

Expected: 已知字段断言因缺少 `last_assistant_message` 失败，且无效字段用例因未抛错失败。

- [x] **Step 3: 添加最小运行时类型校验**

在 `HookInput` 和返回对象中加入：

```ts
interface HookInput {
  last_assistant_message?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

return {
  transcript_path: optionalString(parsed, "transcript_path"),
  session_id: optionalString(parsed, "session_id"),
  stop_hook_active: optionalBoolean(parsed, "stop_hook_active"),
  last_assistant_message: optionalString(parsed, "last_assistant_message")
};
```

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/hook-input.test.ts`

Expected: 该文件全部测试通过。

### Task 2: 建立 Stop 专用内存分析边界

**Files:**
- Create: `tests/hook-analysis.test.ts`
- Create: `src/core/hook-analysis.ts`

- [x] **Step 1: 写缺失补全、保守去重和完整分析链路的失败测试**

测试通过临时 Claude JSONL 文件调用期望 API：

```ts
const report = await analyzeClaudeStopFile(file, "Next step: run the release checks.");

expect(report.summary.total_messages).toBe(parsedCount + 1);
expect(report.messages.at(-1)).toMatchObject({
  role: "assistant",
  content: "Next step: run the release checks.",
  protected: true,
  decision: "keep_protected"
});
expect(report.resume.nextSteps.at(-1)?.text).toBe("Next step: run the release checks.");
```

再覆盖以下独立行为：

```ts
// 最新 assistant 后即使有 metadata，CRLF/首尾空白等价时也不追加。
expect(deduplicated.summary.total_messages).toBe(parsedCount);

// 只有更早 assistant 相同时仍追加，避免漏掉当前回合的真实重复回答。
expect(repeatedCurrentReply.summary.total_messages).toBe(parsedCount + 1);

// undefined、空串和纯空白不追加。
expect(blank.summary.total_messages).toBe(parsedCount);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/hook-analysis.test.ts`

Expected: 模块导入失败，因为 `src/core/hook-analysis.ts` 尚不存在。

- [x] **Step 3: 实现最小 Stop 分析模块**

创建 `src/core/hook-analysis.ts`，对外只导出文件级函数：

```ts
export async function analyzeClaudeStopFile(
  file: string,
  lastAssistantMessage?: string
): Promise<AnalysisReport> {
  const input = await readFile(file, "utf8");
  const parsed = parseJsonl(input, file);
  const messages = supplementLastAssistantMessage(parsed, file, lastAssistantMessage);
  return createReport(analyzeMessages(messages), file);
}
```

内部补全遵循设计文档的完整规则：

```ts
function comparableText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function latestAssistant(messages: NormalizedMessage[]): NormalizedMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "assistant") return messages[index];
  }
  return undefined;
}
```

补入消息继承 transcript source、最后 source line 和最近 session ID，使用不与现有 message ID 冲突的 `trimctx:hook:last-assistant-message` 前缀，不设置 timestamp/tool，并通过新数组返回。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/hook-analysis.test.ts`

Expected: 补全、去重、空白和分析链路测试全部通过。

### Task 3: 接入 Stop hook 并证明真实进程行为

**Files:**
- Modify: `tests/hook.test.ts`
- Modify: `src/core/hook.ts`

- [x] **Step 1: 写 50k 压力边界和失败前无副作用的 CLI 回归**

构造一个约 49,000 tokens 的单消息 Claude transcript，并传入约 1,100 tokens 的最终回复：

```ts
const baseContent = Array.from({ length: 49_000 }, () => "base").join(" ");
const finalReply = `${Array.from({ length: 1_100 }, () => "final").join(" ")}\nNext step: run release checks.`;
```

先验证未传字段时 `hook --dry-run` 输出低压力；再传字段运行 Stop，验证输出包含 `medium`、`.claude/CLAUDE.md` 受管区块显示 2 条消息和 MEDIUM，且 transcript SHA-256 不变。

另外传入：

```ts
{ transcript_path: transcriptPath, last_assistant_message: 123 }
```

验证 stderr 为固定类型错误，项目下没有创建 `.claude`，transcript SHA-256 不变，stderr 不包含回复内容。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/hook.test.ts`

Expected: 压力边界仍输出 low 且不会创建受管区块，因为 Stop 尚未消费该字段。

- [x] **Step 3: 用 Stop 专用分析函数替换现有 `analyzeFile` 调用**

在 `src/core/hook.ts` 中改为：

```ts
import { analyzeClaudeStopFile } from "./hook-analysis.js";

const report = await analyzeClaudeStopFile(sessionFile, input.last_assistant_message);
```

SessionStart 函数、压力分支、存储模块和所有输出文案不变。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/hook-input.test.ts tests/hook-analysis.test.ts tests/hook.test.ts`

Expected: 三个文件全部通过；成功和失败路径均不修改 transcript。

### Task 4: 同步用户与开发文档

**Files:**
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 更新双语 hook 写入范围说明**

明确 Stop 会优先使用 stdin `last_assistant_message` 补齐尚未落盘的最终回复，已落盘时保守去重；补全仅在内存中，原始 transcript 仍只读。

- [x] **Step 2: 更新状态与变更记录**

把 `last_assistant_message` 从“待审计候选”改为已验证和已修复，记录根因、去重边界、公开命令不受影响及验证证据；CHANGELOG 在 Unreleased/Fixed 增加一条面向用户的修复说明。

- [x] **Step 3: 检查文档一致性**

Run: `rg -n "last_assistant_message|transcript.*只读|transcript.*read-only" docs/user docs/dev/status-and-next-steps.md CHANGELOG.md`

Expected: 中英文说明一致，不声称 Stop 会写 transcript，不扩大 hook 权限。

### Task 5: 全量质量门

**Files:**
- Verify only

- [x] **Step 1: 运行聚焦和全量测试**

Run: `npx vitest run tests/hook-input.test.ts tests/hook-analysis.test.ts tests/hook.test.ts`

Expected: 全部通过。

Run: `npm test`

Expected: 0 failures。

- [x] **Step 2: 运行 TypeScript 与发布构建**

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行 npm 打包和 fresh-install smoke**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: package contents、六命令和 packed fresh-install smoke 全部通过。

Run: `npm pack --dry-run --json --silent`

Expected: 包清单包含既有发布资产，不包含测试、临时验证文件或真实 transcript。

- [x] **Step 4: 检查差异与工作区卫生**

Run: `git diff --check`

Expected: 无 whitespace errors；允许 Git 报告既有 LF/CRLF 转换提示。

Run: `git status --short`

Expected: `.vscode/` 保持未触碰，无 `.tgz` 或真实验证输出残留，所有新增改动都属于当前连续审计。
