# Conversation Export Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增发布可用的 `trimctx export [file] -o <conversation.md>`，完整、确定性地导出 parser 识别的规范化会话消息，同时保持原始 JSONL 只读。

**Architecture:** 在现有 `parseJsonl` 后、analysis pipeline 前建立独立分支。纯 formatter 负责 `trimctx.transcript.v1` 事件账本和安全围栏，薄命令层负责严格输入绑定、SHA-256、扩展名、原子写入与完成摘要；客户端资产只调用 CLI，不复制解析逻辑。

**Tech Stack:** Node.js 20、TypeScript、Commander、Vitest、现有 platform file helpers、OpenSpec

**Project rule:** `AGENTS.md` 未授权创建提交，因此本计划不包含 commit 步骤；所有变更留在工作树供用户最终验收。

---

### Task 1: Transcript Markdown 纯 formatter

**Files:**
- Create: `tests/transcript-markdown.test.ts`
- Create: `src/core/transcript-markdown.ts`

- [ ] **Step 1: 写完整性与顺序失败测试**

构造覆盖 `system/developer/user/assistant/tool/unknown` 的 `NormalizedMessage[]`，其中包含 `keep`、`remove_candidate`、空正文和工具关联，断言：

```ts
const result = formatTranscriptMarkdown({
  file: "session.jsonl",
  sha256: "a".repeat(64),
  messages
});

expect(result.messageCount).toBe(messages.length);
expect(result.source).toBe("claude-code-jsonl");
expect(result.sessionId).toBe("session-1");
expect(result.markdown).toContain("trimctx.transcript.v1");
expect(result.markdown.match(/^### Message /gm)).toHaveLength(messages.length);
for (const message of messages) expect(result.markdown).toContain(message.content);
expect(result.markdown.indexOf("system body")).toBeLessThan(result.markdown.indexOf("user body"));
expect(result.markdown).not.toContain("remove_candidate");
```

- [ ] **Step 2: 写围栏与确定性失败测试**

正文包含 HTML、Markdown heading、三/四反引号、三/四波浪号和 Unicode，断言正文只出现一次、消息 heading 数不被注入内容改变、结果重复调用深度相等；空数组必须抛出：

```ts
expect(() => formatTranscriptMarkdown({ file: "empty.jsonl", sha256, messages: [] }))
  .toThrow("No conversation messages found");
expect(formatTranscriptMarkdown(input)).toEqual(formatTranscriptMarkdown(input));
```

- [ ] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/transcript-markdown.test.ts`

Expected: FAIL，`../src/core/transcript-markdown.js` 尚不存在。

- [ ] **Step 4: 实现最小 formatter**

新增以下公共接口和结构：

```ts
export const TRANSCRIPT_FORMAT_VERSION = "trimctx.transcript.v1" as const;

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

export function formatTranscriptMarkdown(input: TranscriptMarkdownInput): TranscriptMarkdownResult {
  if (input.messages.length === 0) {
    throw new Error(`No conversation messages found in ${input.file}`);
  }
  const source = input.messages[0]!.source;
  const sessionId = input.messages.find(message => message.sessionId)?.sessionId;
  const lines = [
    "# trimctx Conversation Transcript",
    "",
    "> **Private artifact:** This file contains unredacted normalized conversation content, including system instructions and tool data. Review it before sharing.",
    "> This is a parser-normalized transcript, not a byte-for-byte backup of the source JSONL.",
    "",
    "## Source",
    "",
    `- Format version: ${codeSpan(TRANSCRIPT_FORMAT_VERSION)}`,
    `- Source file: ${codeSpan(input.file)}`,
    `- Source SHA-256: ${codeSpan(input.sha256)}`,
    `- Source format: ${codeSpan(source)}`,
    ...(sessionId ? [`- Session ID: ${codeSpan(sessionId)}`] : []),
    `- Messages: ${input.messages.length}`,
    "",
    "## Normalization Boundary",
    "",
    normalizationNote(source),
    "",
    "## Messages",
    ""
  ];
  input.messages.forEach((message, index) => appendMessage(lines, message, index + 1));
  return { markdown: `${lines.join("\n").trimEnd()}\n`, source, sessionId, messageCount: input.messages.length };
}
```

围栏选择必须使用两个候选字符：

```ts
function contentFence(content: string): string {
  const backticks = "`".repeat(Math.max(3, longestRun(content, "`") + 1));
  const tildes = "~".repeat(Math.max(3, longestRun(content, "~") + 1));
  return backticks.length <= tildes.length ? backticks : tildes;
}
```

同文件完整定义辅助函数：

```ts
const ROLE_LABELS: Record<MessageRole, string> = {
  system: "System",
  developer: "Developer",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  unknown: "Unknown"
};

function appendMessage(lines: string[], message: NormalizedMessage, sequence: number): void {
  lines.push(`### Message ${sequence} - ${ROLE_LABELS[message.role]}`, "");
  appendField(lines, "Role", message.role);
  appendField(lines, "ID", message.id);
  appendField(lines, "Source line", String(message.sourceLine));
  appendField(lines, "Timestamp", message.timestamp);
  appendField(lines, "Parent ID", message.parentId);
  appendField(lines, "Tool name", message.tool?.toolName);
  appendField(lines, "Tool use ID", message.tool?.toolUseId);
  appendField(lines, "Tool result for", message.tool?.toolResultFor);
  const fence = contentFence(message.content);
  lines.push("", `${fence}text`, message.content, fence, "");
}

function appendField(lines: string[], label: string, value: string | undefined): void {
  if (value !== undefined) lines.push(`- ${label}: ${codeSpan(value)}`);
}

function codeSpan(value: string): string {
  const flattened = value.replace(/[\r\n]+/g, " ");
  const fence = "`".repeat(Math.max(1, longestRun(flattened, "`") + 1));
  const pad = /^[ `]|[ `]$/.test(flattened);
  return `${fence}${pad ? " " : ""}${flattened}${pad ? " " : ""}${fence}`;
}

function longestRun(value: string, character: "`" | "~"): number {
  let longest = 0;
  let current = 0;
  for (const item of value) {
    current = item === character ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function normalizationNote(source: MessageSource): string {
  if (source === "claude-code-jsonl") {
    return "- Includes parser-normalized Claude messages and recognized metadata. Content blocks may be merged and duplicate streaming frames collapsed.";
  }
  if (source === "codex-jsonl") {
    return "- Includes supported session instructions, messages, tool events, and compacted boundaries. Encrypted reasoning and runtime event/turn metadata are excluded by the parser contract.";
  }
  return "- Includes parser-normalized top-level role/content messages and messages arrays supported by the OpenAI adapter.";
}
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `npx vitest run tests/transcript-markdown.test.ts`

Expected: PASS，所有正文、顺序、围栏和确定性断言通过。

### Task 2: Export CLI 与原子文件输出

**Files:**
- Create: `tests/cli-export.test.ts`
- Create: `src/commands/export.ts`
- Modify: `src/commands/index.ts`

- [ ] **Step 1: 写三格式 CLI 失败测试**

对 `claude-code-realistic.jsonl`、`openai-chat.jsonl`、`codex-realistic.jsonl` 参数化运行：

```ts
const before = createHash("sha256").update(await readFile(file)).digest("hex");
const result = await runCli(["export", file, "-o", output]);
const markdown = await readFile(output, "utf8");
expect(result.code).toBe(0);
expect(result.stdout).not.toContain(messages[0]!.content);
expect(markdown.match(/^### Message /gm)).toHaveLength(parseJsonl(input, file).length);
expect(await sha256(file)).toBe(before);
```

另写：省略 file 使用 `TRIMCTX_TRANSCRIPT_PATH`；无绑定失败且不扫描 latest；`.MD` 可用；`.txt` 保留旧目标；输入同路径失败；invalid JSONL 保留旧目标并报告行号；相同输入重复输出字节一致。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/cli-export.test.ts`

Expected: FAIL，Commander 报 unknown command `export`。

- [ ] **Step 3: 实现命令**

新增并注册：

```ts
export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .argument("[file]")
    .requiredOption("-o, --output <conversation.md>")
    .description("Export a complete normalized conversation transcript as Markdown.")
    .action(async (file: string | undefined, options: { output: string }) => {
      const inputFile = file ?? await resolveBoundSessionFile();
      await assertDifferentFiles(inputFile, options.output, "Export output must be different from input file");
      if (extname(options.output).toLowerCase() !== ".md") {
        throw new Error("export output must end in .md");
      }
      const inputHandle = await open(inputFile, "r");
      try {
        const input = await inputHandle.readFile();
        const result = formatTranscriptMarkdown({
          file: inputFile,
          sha256: createHash("sha256").update(input).digest("hex"),
          messages: parseJsonl(input.toString("utf8"), inputFile)
        });
        await atomicWriteFileDistinctFromInput(inputHandle, options.output, result.markdown,
          "Export output must be different from input file");
        process.stdout.write(`export: ${options.output}\nmessages: ${result.messageCount}\nsource: ${result.source}\n`);
      } finally {
        await inputHandle.close();
      }
    });
}
```

在 `registerCommands` 中于 `report` 后注册 `registerExportCommand(program)`。

- [ ] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/transcript-markdown.test.ts tests/cli-export.test.ts tests/platform-files.test.ts tests/file-safety.test.ts`

Expected: PASS，输入 hash 不变，错误路径不替换目标。

### Task 3: 六命令 surface 与客户端资产

**Files:**
- Modify: `tests/cli-surface.test.ts`
- Modify: `tests/cli-commands.test.ts`
- Modify: `tests/package-contents.test.ts`
- Create: `plugins/trimctx/commands/trimctx/export.md`
- Modify: `plugins/trimctx/README.md`
- Modify: `plugins/trimctx/.system`
- Modify: `codex/skills/trimctx/SKILL.md`

- [ ] **Step 1: 写公开 surface 失败断言**

把公开命令数组更新为：

```ts
const publicCommands = ["init", "analyze", "report", "export", "new-chat", "compress"];
```

增加 `export --help` 断言，要求 `[file]`、必填 output，且不出现 discovery、threshold 或压缩选项。

- [ ] **Step 2: 写客户端和 packed smoke 失败断言**

要求 tarball 包含 `plugins/trimctx/commands/trimctx/export.md`；Claude asset 包含绑定命令和隐私警告；Codex skill 包含显式文件命令。packed install 后实际执行：

```ts
const source = path.resolve("tests/fixtures/openai-chat.jsonl");
const output = path.join(tempDir, "conversation.md");
await execFileAsync(trimctxBin, ["export", source, "-o", output], { shell: process.platform === "win32" });
expect(await readFile(output, "utf8")).toContain("# trimctx Conversation Transcript");
```

执行前后比较 fixture bytes/hash。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts`

Expected: FAIL，五命令断言和客户端 asset 清单尚未更新。

- [ ] **Step 4: 新增/更新客户端资产**

Claude command 固定执行：

```bash
trimctx export "$TRIMCTX_TRANSCRIPT_PATH" -o conversation.md
```

缺失绑定时停止，不使用 latest。完成说明必须包含输出路径、原文件未修改、产物未脱敏且分享前审查。Codex skill 增加显式文件命令，并把多窗口传参清单扩展到 `export`。

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `npx vitest run tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts`

Expected: PASS，包括安装后真实 transcript 生成。

### Task 4: 用户、开发与发布文档

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `AGENTS.md`
- Modify: `docs/dev/requirements.md`
- Modify: `docs/dev/iteration-plan.md`
- Modify: `docs/dev/roadmap.md`
- Modify: `docs/dev/execution-plan.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新用户工作流**

在英文和中文入口加入：

```bash
trimctx export path/to/session.jsonl -o conversation.md
trimctx export -o conversation.md # only with a trusted current-window binding
```

明确：包含全部规范化消息、默认不脱敏、不是 raw backup、正文不进入健康报告、Codex 多窗口必须显式确认路径。

- [ ] **Step 2: 更新主线合同**

把当前公开命令面改为六个，并明确 export 是用户批准的有限例外；继续冻结 diagnostics、Web UI、MCP、后台自动化和阈值变化。更新 AGENTS 命令示例和客户端资产说明。

- [ ] **Step 3: 更新 Unreleased**

在 `CHANGELOG.md` 添加 `Added`，记录 export、原子只读边界和客户端入口；不修改 `package.json` version。

- [ ] **Step 4: 检查一致性**

Run: `rg -n "five-command|five public|五个公开|五个命令" AGENTS.md README*.md docs tests plugins codex`

Expected: 当前合同不再声称五命令；历史版本说明可保留并明确属于历史。

### Task 5: 发布与真实样本验证

**Files:**
- Modify only planned files if verification finds a defect.
- Generate ignored output only under: `tmp-real-validation/`

- [ ] **Step 1: 聚焦回归**

Run: `npx vitest run tests/transcript-markdown.test.ts tests/cli-export.test.ts tests/parser.claude-code-jsonl.test.ts tests/parser.openai-jsonl.test.ts tests/parser.codex-jsonl.test.ts tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 全量测试和构建**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0，无 TypeScript errors。

Run: `npm run build:publish`

Expected: exit 0，生成可运行 bundled `dist/cli.js`。

- [ ] **Step 3: 包清单**

Run: `npm pack --dry-run --json`

Expected: exit 0；包含 `dist/cli.js`、Claude export command、Codex skill、用户文档；不含 `src/`、私有 JSONL 或 `tmp-real-validation/`。

- [ ] **Step 4: 真实样本只读验证**

先计算指定真实 JSONL SHA-256，再运行：

```powershell
npx tsx src/cli.ts export "<sample.jsonl>" -o tmp-real-validation/conversation.md
```

再次计算输入 SHA-256，要求完全一致；用 `parseJsonl` 消息数核对 Markdown `### Message` 数；读取首尾事件和文件头，不把正文打印到日志或提交仓库。

- [ ] **Step 5: 完成审计**

Run: `git diff --check`

Run: `openspec validate add-conversation-transcript-command --strict`

Run: `git status --short`

Expected: 无 whitespace 错误，OpenSpec valid，只有计划内 tracked changes 和用户原有 `.vscode/`；逐条把 OpenSpec requirements/scenarios 映射到实现、测试或运行证据。
