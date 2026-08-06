# Phase 0 review 双工件事务设计

## 背景与根因

`phase0:review` 从同一份内存输出生成 `phase0-review.json` 和 `phase0-review.md`，但当前依次使用两次普通 `writeFile()`：JSON 成功后 Markdown 若写入失败，目录中会留下新 JSON 与旧 Markdown；单个文件写入失败时也可能先截断既有工件。两个文件在语义上是同一审计快照，却没有共同提交边界。

现有 `atomicWriteFile()` 只保证单目标替换。简单串联两个单文件原子写仍会在第二个目标失败时保留第一个新目标，而且单文件 helper 在 Windows backup cleanup 失败时可能已经完成提交后再抛错，调用方无法可靠推断提交状态。因此该问题需要显式文件集事务，而不是预检或顺序调用两个单文件 helper。

## 目标

- 成功返回时 JSON 与 Markdown 都来自同一次 review 计算。
- 任一 staging 或 commit 失败时，事务必须尝试恢复所有已修改目标；只有 restore/rollback 自身失败时才允许残留，并必须返回聚合错误与保留 backup。
- 原本不存在的目标在 rollback 时恢复为不存在；原本存在的普通文件恢复原文件。
- operation、restore 和 stage-cleanup 错误必须同时保留，不能让 cleanup 覆盖根因。
- 无法恢复的 backup 或无法删除的 stage 必须保留供人工处理。
- 不改变 review schema、metrics、Markdown 内容、stdout 或 trust gate。

## 非目标

- 不提供断电、进程强制终止或操作系统崩溃后的 journal 恢复。
- 不协调并发运行的多个 `phase0:review` 进程。
- 不修改 `phase0:run` 的多工件语义。
- 不把该 helper 接入公开六命令或其他产品写路径。
- 不改变 scorer、threshold、safety 或 compression。

## 边界与接口

新增 `scripts/phase0-review-output.ts`：

```ts
export async function writePhase0ReviewArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void>
```

helper 只拥有固定的 `phase0-review.json` 与 `phase0-review.md` 两个目标，保持开发脚本范围收敛。`phase0-review.ts` 继续负责计算和格式化，只把两个完整字符串一次性交给 helper。

## 数据流

1. 为两个目标生成同目录随机 `.stage` 路径。
2. 使用 exclusive open 写完全部 stage；只有 open 成功后才拥有并负责清理该路径。
3. 在修改目标前检查两个目标：`ENOENT` 表示原本不存在；已有目标必须是普通文件。目录、symlink 或其他类型 fail closed。
4. 逐个提交：已有目标先 rename 到随机 `.bak`，再把 stage rename 到目标；新目标直接 rename。
5. 任一 commit 失败时，先恢复当前目标，再逆序 rollback 已提交目标。
6. 两个 commit 都成功后删除 backups；backup cleanup 失败时保留新的一致工件对和残留 backup，并返回错误。
7. finally 清理仍归本事务所有的 stage；cleanup 错误与原操作错误聚合。

## 状态与错误语义

- staging 失败：两个目标均不变。
- 当前目标 commit 失败且 restore 成功：当前目标不变，之前已提交目标逆序恢复。
- rollback 成功：调用失败，但两个目标恢复到调用前状态。
- restore/rollback 失败：返回 `AggregateError`，保留所有原因；未恢复 backup 不删除。
- stage cleanup 失败：返回 `AggregateError`，残留 stage 保留；错误不读取或回显工件正文。
- backup cleanup 失败：两个新目标已经一致提交；返回 cleanup 错误并保留 backup，不回滚已成功的新工件对。

## 测试策略

- 进程级复现：让 Markdown 目标为目录，确认旧实现先覆盖 JSON；新实现必须在任何目标修改前失败并保留旧 JSON。
- 注入第二个 commit 失败，确认两个既有目标均恢复且无 stage/backup 残留。
- 第一个目标原本不存在、第二个 commit 失败时，确认第一个目标被删除、第二个旧目标恢复。
- 注入 rollback/cleanup 错误，确认所有原因被聚合且可恢复 backup/stage 被保留。
- 保留现有 Phase 0 review 内容、隐私、quality gate 和 locked/failed/review_required 回归。

## 成功标准

- 可重复的第二目标失败不再留下新旧混合 review 工件。
- 正常 review 输出内容和文件名不变。
- 可恢复的进程内失败恢复完整旧状态；不可恢复状态保留明确错误和恢复材料。
- 聚焦测试、完整测试、构建、packed-install、22-file package 清单和 `git diff --check` 均通过。
