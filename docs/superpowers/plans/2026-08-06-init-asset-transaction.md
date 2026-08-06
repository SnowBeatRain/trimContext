# Init Asset Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Claude/Codex 资产安装在 copy 或 rename 失败时保持旧目标完整，并对 `--client all` 已提交目标执行逆序回滚。

**Architecture:** 新增 `init-transaction.ts`，先把全部 source 复制到 destination 同级 staging，再以 backup + rename 提交。`init-installer.ts` 保留现有预检和用户输出；事务失败时逆序恢复，恢复失败用 `AggregateError` 同时报告并保留 backup。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、`node:fs/promises`

---

### Task 1: Staging copy 失败不修改目标

**Files:**
- Create: `tests/init-installer-failure.test.ts`
- Create: `src/commands/init-transaction.ts`
- Modify: `src/commands/init-installer.ts`

- [x] **Step 1: 写第二资产 copy 失败回归**

创建两个已有目标，各含独立 `old.txt`；mock `cp` 的第二次调用抛出 `injected second asset copy failure`，第一次调用真实 filesystem：

```ts
await expect(installInitAssets([first.asset, second.asset], { force: true }))
  .rejects.toThrow("injected second asset copy failure");

expect(await readFile(first.oldFile, "utf8")).toBe("old-first");
expect(await readFile(second.oldFile, "utf8")).toBe("old-second");
expect(await fileExists(first.currentFile)).toBe(false);
expect(await fileExists(second.currentFile)).toBe(false);
expect(await transactionArtifacts(first.parent)).toEqual([]);
expect(await transactionArtifacts(second.parent)).toEqual([]);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/init-installer-failure.test.ts`

Expected: 当前第一个目标已替换、第二个目标已删除，旧内容断言失败。

- [x] **Step 3: 实现全量 staging 边界**

创建：

```ts
export interface InitAssetTransactionEntry {
  asset: InitAsset;
  destinationExists: boolean;
}

export async function installInitAssetTransaction(
  entries: readonly InitAssetTransactionEntry[]
): Promise<void>;
```

先为所有 entry 生成同级 `.trimctx-<random>.stage` 并完成 `cp`。初始 commit 可按现有顺序删除已有目标并 rename stage；`finally` 删除仍存在的 stage。

`init-installer.ts` 在全部现有预检通过后调用：

```ts
await installInitAssetTransaction(assets.map((asset, index) => ({
  asset,
  destinationExists: destinationExists[index]!
})));
```

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/init-installer-failure.test.ts tests/init-boundaries.test.ts`

Expected: copy failure 保留两个旧目标且无 stage；既有 16 项 init boundary 通过。

### Task 2: Commit 失败逆序恢复全部目标

**Files:**
- Modify: `tests/init-installer-failure.test.ts`
- Modify: `src/commands/init-transaction.ts`

- [x] **Step 1: 写第二目标 stage rename 失败回归**

所有 copy 走真实 filesystem；mock `rename` 仅在 `.stage -> second.destination` 时抛出：

```ts
await expect(installInitAssets([first.asset, second.asset], { force: true }))
  .rejects.toThrow("injected second asset commit failure");
```

断言两个 `old.txt` 均恢复、两个新 `current.txt` 均不存在，且两个父目录无 `.trimctx-*.stage/.bak`。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/init-installer-failure.test.ts`

Expected: 第一个目标保留新内容或第二个目标缺失，证明没有跨目标 rollback。

- [x] **Step 3: 实现 backup commit 与逆序 rollback**

已有目标 commit：

```ts
await rename(destination, backupPath);
try {
  await rename(stagePath, destination);
} catch (error) {
  await rename(backupPath, destination);
  throw error;
}
```

所有 commit 保留 backup；外层 catch 对已提交项逆序删除新目标并恢复 backup，对新目标删除本次 destination。全部成功后再删除 backup。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npx vitest run tests/init-installer-failure.test.ts tests/init-boundaries.test.ts`

Expected: copy/commit 两类故障与所有成功路径通过，无 transaction artifact。

### Task 3: Rollback 失败保留证据和 backup

**Files:**
- Modify: `tests/init-installer-failure.test.ts`
- Modify: `src/commands/init-transaction.ts`

- [x] **Step 1: 写 rollback rename 失败回归**

注入第二目标 commit failure，并在逆序恢复第一目标 `.bak -> destination` 时再抛出 `injected first asset restore failure`。断言：

```ts
expect(error).toBeInstanceOf(AggregateError);
expect((error as AggregateError).errors.map(String).join("\n"))
  .toContain("injected second asset commit failure");
expect((error as AggregateError).errors.map(String).join("\n"))
  .toContain("injected first asset restore failure");
```

并查找第一目标父目录的 `.bak`，断言其中 `old.txt` 仍为 `old-first`。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/init-installer-failure.test.ts`

Expected: restore error 覆盖原 commit error，或 backup 被 finally 删除。

- [x] **Step 3: 聚合恢复错误并限制清理范围**

rollback 收集错误而非短路；有恢复错误时抛出：

```ts
throw new AggregateError(
  [commitError, ...rollbackErrors],
  "Failed to install and restore trimctx assets"
);
```

只有 backup 成功恢复或全事务成功后才允许删除对应 backup。

- [x] **Step 4: 运行完整 installer 聚焦测试**

Run: `npx vitest run tests/init-installer-failure.test.ts tests/init-boundaries.test.ts tests/hook.test.ts tests/cli-commands.test.ts`

Expected: 故障注入、成功安装、hook preflight 和 CLI 全部通过。

### Task 4: 文档与完整质量门

**Files:**
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录 staging/rollback 边界与硬终止限制**

说明 copy/rename 的进程内错误会恢复，恢复失败保留 backup；强制终止/断电仍不承诺自动恢复。

- [x] **Step 2: 运行全量测试与 build**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行 packed-install 与发布检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: 5/5 通过。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件。

- [x] **Step 4: 运行差异与卫生检查**

Run: `git diff --check`

Expected: 无 whitespace errors，仅既有 LF -> CRLF 提示；无 `.tgz`、私有 Phase 0 工件或 `.vscode` 修改。
