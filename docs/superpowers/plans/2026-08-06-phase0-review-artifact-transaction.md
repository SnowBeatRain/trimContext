# Phase 0 Review Artifact Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 `phase0:review` 在 JSON/Markdown 任一写入失败时留下新旧混合或被截断的审计工件。

**Architecture:** 新增 script-scoped `writePhase0ReviewArtifacts()`，先把两个完整字符串写入同目录 exclusive stage，再通过 backup + rename 提交，并在 commit 失败时逆序恢复。`phase0-review.ts` 保持计算/格式化职责，只把两个结果交给该事务；公开 CLI 与共享平台写路径不变。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、`node:fs/promises`

---

### Task 1: 复现普通双写的部分提交

**Files:**
- Modify: `tests/phase0-review.test.ts`
- Create: `scripts/phase0-review-output.ts`
- Modify: `scripts/phase0-review.ts`

- [x] **Step 1: 写进程级失败回归**

在 `tests/phase0-review.test.ts` 导入 `readdir`，新增用例：创建完整五样本 evidence 与有效 labels，预写 `phase0-review.json` 为 `old-json\n`，并把 `phase0-review.md` 创建为目录。运行 review 必须失败，同时断言 JSON 仍是旧内容，且 out dir 中没有 `.stage` / `.bak`：

```ts
test("preserves the existing review pair when an output target is invalid", async () => {
  const { root, reportsDir, labelsDir } = await createReviewFixture();
  await writeValidReviewInputs(reportsDir, labelsDir);
  await writeFile(join(root, "phase0-review.json"), "old-json\n", "utf8");
  await mkdir(join(root, "phase0-review.md"));

  await expect(runReview(reportsDir, labelsDir, root)).rejects.toThrow();

  expect(await readFile(join(root, "phase0-review.json"), "utf8")).toBe("old-json\n");
  expect((await readdir(root)).filter(isReviewTransactionArtifact)).toEqual([]);
});
```

若不新增通用 fixture helper，则在用例中直接复用现有 report/evidence/labels 构造；不要改变既有 fixtures 的指标。

- [x] **Step 2: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 新用例失败，`phase0-review.json` 已从 `old-json` 变成新 review JSON；命令本身因 Markdown 目标为目录而按预期失败。

- [x] **Step 3: 新增最小输出边界**

创建 `scripts/phase0-review-output.ts`，先对固定两个目标执行 ENOENT-only `lstat` 检查，已有目标必须是普通文件，然后暂时保持顺序写入：

```ts
export async function writePhase0ReviewArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void> {
  const outputs = [
    { target: join(outDir, "phase0-review.json"), data: json },
    { target: join(outDir, "phase0-review.md"), data: markdown }
  ];
  for (const output of outputs) await assertRegularFileOrMissing(output.target);
  for (const output of outputs) await writeFile(output.target, output.data, "utf8");
}
```

`assertRegularFileOrMissing()` 只把 `ENOENT` 解释为缺失；目录、symlink 和其他类型抛出不含文件内容的错误。修改 `phase0-review.ts`：移除 `writeFile` import，改为一次调用 helper，并保持 JSON trailing newline、Markdown 和 stdout 内容不变。

- [x] **Step 4: 运行测试确认第一轮 GREEN**

Run: `npx vitest run tests/phase0-review.test.ts`

Expected: 8/8 passed；非法 Markdown 目标在 JSON 写入前被拒绝。

### Task 2: 增加 stage/backup/rollback 文件集事务

**Files:**
- Create: `tests/phase0-review-output-failure.test.ts`
- Modify: `scripts/phase0-review-output.ts`

- [x] **Step 1: 写第二提交失败回归**

使用 `vi.mock("node:fs/promises")` 包装 `lstat/open/rename/rm`，其余调用委托真实 fs。创建两个既有目标并让 `rename(<md-stage>, <md-target>)` 抛出 `EACCES`：

```ts
await expect(writePhase0ReviewArtifacts(root, "new-json\n", "new-md\n"))
  .rejects.toThrow("injected markdown commit failure");
expect(await readFile(jsonTarget, "utf8")).toBe("old-json\n");
expect(await readFile(markdownTarget, "utf8")).toBe("old-md\n");
expect(await transactionArtifacts(root)).toEqual([]);
```

- [x] **Step 2: 写新目标 rollback 与错误聚合回归**

同一测试文件再覆盖三种状态：

```ts
// JSON 原本不存在，Markdown 第二提交失败：JSON 恢复为不存在，Markdown 恢复旧内容。
expect(await fileExists(jsonTarget)).toBe(false);
expect(await readFile(markdownTarget, "utf8")).toBe("old-md\n");

// 第二提交失败后，JSON backup restore 再失败：AggregateError 同时包含两类错误，backup 保留旧 JSON。
expect(caught).toBeInstanceOf(AggregateError);
expect(errorMessages(caught)).toContain("injected markdown commit failure");
expect(errorMessages(caught)).toContain("injected json restore failure");
expect(await readFile(retainedJsonBackup, "utf8")).toBe("old-json\n");

// 第二 stage open 失败且第一 stage cleanup 失败：两类错误聚合，未删除 stage 保留新 JSON 内容。
expect(errorMessages(caught)).toContain("injected markdown stage failure");
expect(errorMessages(caught)).toContain("injected json stage cleanup failure");
expect(await readFile(retainedJsonStage, "utf8")).toBe("new-json\n");
```

每个用例在 `finally` 恢复 mock implementation，并用真实 `rm` 清理独立临时目录。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/phase0-review-output-failure.test.ts tests/phase0-review.test.ts`

Expected: 现有最小 helper 不调用 stage/rename；故障注入不生效或目标保留新内容，四项 transaction 回归失败。

- [x] **Step 4: 实现完整事务状态机**

在 `scripts/phase0-review-output.ts` 定义：

```ts
interface StagedArtifact {
  target: string;
  data: string;
  stagePath: string;
  ownsStagePath: boolean;
  destinationExists: boolean;
  backupPath?: string;
  committed: boolean;
}
```

实现以下明确顺序：

1. `stageArtifact()` 使用 `open(stagePath, "wx")` 写入并关闭；exclusive open 成功后才设置 `ownsStagePath = true`。
2. 全部 stage 完成后调用 `assertRegularFileOrMissing()`，记录每个目标是否存在。
3. `commitArtifact()` 对既有目标先 `rename(target, backup)`，再 `rename(stage, target)`；stage rename 成功后立即清除 stage 所有权并标记 committed。当前提交失败时先恢复自己的 backup。
4. commit loop 失败时对已经 committed 的项逆序执行 `rm(target)`，再把 backup rename 回目标；新目标只删除。
5. 全部提交成功后尝试清理所有 backup；cleanup 失败保留新的一致目标对与残留 backup，并聚合全部 cleanup 错误。
6. finally 清理所有仍 owned 的 stage；若主操作也失败，用递归 `errorComponents()` 把 operation/restore/cleanup 原因平铺进一个 `AggregateError`。

错误消息只允许包含固定说明和目标路径，不读取或回显 stage/backup 正文。

- [x] **Step 5: 运行聚焦测试确认 GREEN**

Run: `npx vitest run tests/phase0-review-output-failure.test.ts tests/phase0-review.test.ts tests/phase0-evidence.test.ts`

Expected: 新增 5 项和既有 13 项 Phase 0 review/evidence 回归全部通过。

### Task 3: 文档与完整质量门

**Files:**
- Modify: `docs/dev/phase0/phase0-plan.md`
- Modify: `docs/dev/phase0/manual-label-guide.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录事务保证和边界**

四处文档统一说明：JSON/Markdown 先完整 staging，再作为一个进程内事务提交；可恢复失败回滚旧对；rollback/cleanup 失败聚合并保留恢复材料；强制终止、断电、并发 writer 不提供 journal/协调；schema、metrics、trust gate、公开 CLI、scorer 和 compression 不变。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 43 个测试文件、375 项测试通过。

Run: `npm run build`

Expected: exit 0。

- [x] **Step 3: 运行发布与卫生检查**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: 5/5 passed。

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件；无 `.tgz`、私有 Phase 0 工件、`.vscode`、scripts transaction helper 或 superpowers spec/plan。

Run: `git diff --check`

Expected: exit 0，仅有既有 LF -> CRLF 提示。
