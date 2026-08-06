# Atomic Write Cleanup Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让原子写在 temp handle/file 清理失败时保留主错误与全部 cleanup 错误，并暴露无法删除的残留 temp。

**Architecture:** `writeAtomicFile()` 继续拥有 temp 生命周期，在外层 catch 记录主错误，在 finally 中顺序收集 handle close 与 temp rm 错误。仅当 cleanup 失败时构造平铺 `AggregateError`；cleanup 成功保持原错误身份和成功行为。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、`node:fs/promises`

---

### Task 1: 复现 commit + temp cleanup 双失败

**Files:**
- Modify: `tests/platform-files-failure.test.ts`
- Test: `src/platform/files.ts`

- [x] **Step 1: 扩展 fs mock 并写故障回归**

mock `rm`，让普通 atomic write 的 commit rename 抛 `injected ordinary atomic commit failure`，让 `.trimctx-*.tmp` 删除抛 `injected atomic temp cleanup failure`：

```ts
vi.mocked(rename).mockRejectedValueOnce(commitError);
vi.mocked(rm).mockImplementation(async (path, options) => {
  if (String(path).endsWith(".tmp")) throw cleanupError;
  await actualFs.rm(path, options);
});

let caught: unknown;
try {
  await atomicWriteFile(output, "replacement settings\n");
} catch (error) {
  caught = error;
}

expect(caught).toBeInstanceOf(AggregateError);
const messages = (caught as AggregateError).errors.map(String).join("\n");
expect(messages).toContain("injected ordinary atomic commit failure");
expect(messages).toContain("injected atomic temp cleanup failure");
expect(await readFile(output, "utf8")).toBe("existing settings\n");
```

查找唯一 `.trimctx-*.tmp`，确认其内容为 replacement；finally 恢复 rm mock 并用真实 filesystem 清理测试目录。

- [x] **Step 2: 写 temp path 所有权回归**

扩展 `open` mock。第一项在 exclusive open mock 内用真实 filesystem 创建相同 temp path 的 sentinel，然后抛 `EEXIST`；断言 atomic write 返回 open error、sentinel 内容不变、未调用 rm。第二项对不存在的普通 output 成功 atomic write，清空 rm 调用记录后断言 commit 后没有 temp rm 调用。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/platform-files-failure.test.ts`

Expected: 双失败测试收到普通 commit Error 而不是 `AggregateError`；open failure 测试发现 sentinel 被删除；成功 commit 测试发现旧 temp 名仍调用了 rm。

### Task 2: 聚合主操作与 cleanup errors

**Files:**
- Modify: `src/platform/files.ts`
- Test: `tests/platform-files-failure.test.ts`

- [x] **Step 1: 记录主操作失败**

在 `writeAtomicFile()` 中加入：

```ts
let operationFailed = false;
let operationError: unknown;
let ownsTempPath = false;
```

并在 finally 前增加 catch：

```ts
} catch (error) {
  operationFailed = true;
  operationError = error;
  throw error;
} finally {
```

- [x] **Step 2: 收集而非吞掉 cleanup errors**

exclusive open 成功后设置 `ownsTempPath = true`，直接 rename 或 Windows replacement 成功后设置 false。替换当前两个 `.catch(() => undefined)`：

```ts
const cleanupErrors: unknown[] = [];
if (tempHandle !== undefined) {
  try {
    await tempHandle.close();
  } catch (error) {
    cleanupErrors.push(...errorComponents(error));
  }
}
if (ownsTempPath) {
  try {
    await rm(tempFile, { force: true });
  } catch (error) {
    cleanupErrors.push(...errorComponents(error));
  }
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    [...(operationFailed ? errorComponents(operationError) : []), ...cleanupErrors],
    `Failed to write or clean up atomic output: ${outputFile}`
  );
}
```

新增 `errorComponents(error)` 并展平 `AggregateError.errors`；不得读取 temp 内容或删除其他路径。

- [x] **Step 3: 运行平台文件聚焦测试确认 GREEN**

Run: `npx vitest run tests/platform-files-failure.test.ts tests/platform-files.test.ts tests/file-safety.test.ts`

Expected: 新故障回归与全部既有 platform/file safety 测试通过。

### Task 3: 文档与完整质量门

**Files:**
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 cleanup 可观测性与隐私边界**

说明普通/输入绑定原子写共享此语义；cleanup error 不再吞掉，残留 temp 可定位但正文不回显；硬终止仍不保证清理。

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
