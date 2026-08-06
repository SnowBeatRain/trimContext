# New-chat Package Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `new-chat` 原子取得 UID package 目录所有权，并在进程内多文件写入失败时清理半成品目录。

**Architecture:** `new-chat.ts` 保持命令与 package 编排入口，先在内存中完成输出构造，再用 root recursive mkdir + package non-recursive mkdir 取得明确所有权。只有 owned package 进入失败清理；write 与 cleanup 同时失败时用 `AggregateError` 保留两类错误。

**Tech Stack:** Node.js 20+、TypeScript、Commander、Vitest、`node:fs/promises`

---

### Task 1: 复现多文件写入失败残留

**Files:**
- Create: `tests/new-chat-failure.test.ts`
- Test: `src/commands/new-chat.ts`

- [x] **Step 1: 写第二输出 open 失败回归**

在测试内注册真实 Commander command，仅 mock `node:fs/promises.open`；input 与首个输出使用真实临时文件系统，`next-context.md` 的 open 抛出 `injected next-context open failure`：

```ts
const program = new Command();
program.exitOverride();
registerNewChatCommand(program, { packageVersion: "test-version" });

vi.mocked(open).mockImplementation(async (path, flags, mode) => {
  if (String(path).endsWith("next-context.md")) throw writeError;
  return await actualFs.open(path, flags, mode);
});

await expect(program.parseAsync([
  "node", "trimctx", "new-chat", input, "--out", outputRoot
])).rejects.toBe(writeError);

expect(await readdir(outputRoot)).toEqual([]);
expect(await readFile(input, "utf8")).toBe(originalInput);
```

- [x] **Step 2: 写 cleanup 失败错误聚合回归**

同时让 owned `ctx_*` 目录的递归 `rm` 抛出 `injected package cleanup failure`，断言：

```ts
expect(caught).toBeInstanceOf(AggregateError);
const messages = (caught as AggregateError).errors.map(String).join("\n");
expect(messages).toContain("injected next-context open failure");
expect(messages).toContain("injected package cleanup failure");
expect((await readdir(outputRoot)).some((name) => name.startsWith("ctx_"))).toBe(true);
```

测试 finally 恢复 fs mock，并用真实 `rm` 清理临时根目录。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/new-chat-failure.test.ts`

Expected: 第一项发现旧实现残留 UID 目录；第二项只收到 write error 而不是 `AggregateError`。

### Task 2: 实现独占目录所有权与清理

**Files:**
- Modify: `src/commands/new-chat.ts`
- Test: `tests/new-chat-failure.test.ts`

- [x] **Step 1: 在创建目录前完成 input 分析与输出构造**

保留 input handle，先生成 `report`、hash、manifest 与五个字符串；packageDir 创建前不产生 UID 工件。成功 stdout 仍在所有文件写完之后输出。

- [x] **Step 2: 用非递归 mkdir 取得 package 所有权**

删除 `pathExists` 依赖和 check，新增：

```ts
async function createOwnedPackageDirectory(rootDir: string, packageDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  try {
    await mkdir(packageDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`handoff package already exists: ${packageDir}`, { cause: error });
    }
    throw error;
  }
}
```

- [x] **Step 3: 只清理本进程 owned package**

在 `createOwnedPackageDirectory()` 成功后包围多文件 writer：

```ts
try {
  await writeFilesDistinctFromInput(inputHandle, outputs);
} catch (error) {
  try {
    await rm(packageDir, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      `Failed to create and clean up handoff package: ${packageDir}`
    );
  }
  throw error;
}
```

不得清理 rootDir、EEXIST 目录或其他 UID package。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/new-chat-failure.test.ts tests/cli-commands.test.ts`

Expected: 故障注入与 36 项既有 CLI command 回归全部通过；正常包内容和 stdout 不变。

### Task 3: 文档与质量门

**Files:**
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-06-new-chat-package-ownership-design.md`（仅在实现揭示语义差异时）

- [x] **Step 1: 记录 owned-directory 与硬终止边界**

说明原子 mkdir、in-process cleanup、cleanup `AggregateError`，以及硬终止/断电无 journal 的限制；不宣称通用多文件原子性。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行发布与卫生检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件，无 `.tgz`、私有 Phase 0 工件或 `.vscode`。

Run: `git diff --check`

Expected: exit 0，仅有既有 LF -> CRLF 提示。
