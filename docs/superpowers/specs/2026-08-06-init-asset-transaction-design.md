# Init 资产事务安装设计

## 背景与根因

`src/commands/init-installer.ts` 已经能在首个写入前发现模板缺失、目标冲突和不安全的 `--force` 目标，也已通过 facade 级 hook settings 预检消除可预测的组合半安装。但是实际替换仍按以下顺序执行：

```text
rm(existing destination)
  -> cp(source, destination)
  -> 处理下一个客户端
```

复制期间出现权限、磁盘、杀软或其他运行中 I/O 错误时，旧目标已经永久删除。`--client all --force` 的第二个目标失败时，第一个目标也已经更新，没有 backup 或逆序恢复路径。

根因是资产内容直接复制到最终路径，且旧目标在新内容完整可用之前被删除；现有文件级原子写已经采用同目录 temp、backup 和恢复，但目录 installer 尚未应用同一提交模型。

## 目标

- 所有客户端资产必须先完整复制到各自目标同级的 staging 目录，再修改任一最终目标。
- 任一 staging copy 失败时，所有旧目标逐字节保持不变，新目标保持不存在。
- 任一 commit rename 失败时，逆序恢复本次已经提交的全部目标。
- 新安装回滚后目标重新不存在；强制替换回滚后恢复原目录及其全部旧内容。
- rollback 失败时同时保留原始提交错误和恢复错误，并保留未恢复的 backup，不得在清理阶段删除最后可恢复副本。
- 成功后不残留 `.trimctx-*.stage` 或 `.trimctx-*.bak`。
- 保持 `init` 命令、路径、输出、`--force` 授权、dry-run、hooks 和发布资产契约。

## 非目标

- 不为进程被强制终止、断电或操作系统崩溃增加持久化 journal 与下次启动自动恢复。
- 不跨文件系统 rename；staging 和 backup 固定创建在 destination 同级目录。
- 不改变模板内容、安装目标、客户端选择或 hook settings 事务。
- 不改变 parser、report、scorer、threshold、compression、session 或 transcript。

## 方案比较

### 方案 A：全部 staging + 多目标提交/逆序回滚（采用）

先把每个 source 复制到 destination 同级随机 staging。只有全部复制成功后才进入 commit。现有目标先 rename 到随机 backup，再把 staging rename 为最终目标；backup 保留到所有目标提交成功。任一提交失败时，按提交逆序移除新目标并恢复 backup。

它同时覆盖复制失败、单目标提交失败和第二目标导致的跨目标半安装，且所有关键 rename 都发生在同一父目录。

### 方案 B：逐目标 stage-and-swap

每个目标可以避免 `rm -> cp` 的单目标数据丢失，但第二个目标失败时第一个已经提交且 backup 已删除，`--client all` 仍是部分成功，因此不采用。

### 方案 C：仅增强预检

预检只能发现确定性错误，无法证明后续复制和 rename 一定成功，不能解决已复现的运行中故障，因此不采用。

## 模块边界

### `src/commands/init-installer.ts`

继续负责：

- 模板可读性；
- dry-run；
- destination 存在性与非 force 冲突；只有 `ENOENT` 视为不存在，其他访问错误在 staging 前原样失败；
- trimctx-only forced replacement 规则；
- 用户可见安装路径行。

预检完成后，把 `InitAsset` 与预检时的 `destinationExists` 传给事务模块。

### `src/commands/init-transaction.ts`

新增只负责目录 staging、commit、rollback 和清理的模块：

```ts
export interface InitAssetTransactionEntry {
  asset: InitAsset;
  destinationExists: boolean;
}

export async function installInitAssetTransaction(
  entries: readonly InitAssetTransactionEntry[]
): Promise<void>;
```

内部状态为：

```ts
interface StagedAsset {
  entry: InitAssetTransactionEntry;
  stagePath: string;
  backupPath?: string;
  committed: boolean;
}
```

随机路径使用 destination basename、`.trimctx-` 标记和随机十六进制后缀，限定在 destination 父目录中。

## 数据流

### Staging

1. 为每项创建 destination 父目录。
2. 生成不存在的同级 stage 路径。
3. `cp(source, stage, { recursive: true, force: false, errorOnExist: true })`。
4. 任一 copy 失败时，删除所有 stage；最终目标尚未开始修改。

### Commit

对每个 staged item 顺序执行：

- 新目标：`rename(stage, destination)`。
- 已有目标：`rename(destination, backup)`，再 `rename(stage, destination)`。
- 第二次 rename 失败时，立即把当前 backup 恢复到 destination。
- 每项提交后保留 backup，直到全部项目提交完成。

### Rollback

任一项目提交失败后，对已提交项目逆序执行：

- 新目标：递归删除本次新建的 destination。
- 已有目标：递归删除本次新 destination，再 `rename(backup, destination)`。

若 rollback 也失败，抛出 `AggregateError([commitError, ...rollbackErrors])`。未成功恢复的 backup 不进入最终清理。

### Success Cleanup

全部提交成功后删除所有 backup，并在 `finally` 清理未移动或部分复制的 stage。cleanup failure 不伪装成安装失败前状态；它以真实错误退出并保留未删除路径供人工处理。

## 故障与隐私

- 原始 filesystem error 继续作为首个错误传播。
- 恢复错误只包含操作系统错误和本地目标路径，不包含资产正文或 settings 内容。
- copy 阶段没有最终目标副作用。
- backup 恢复失败时保留 backup 数据，禁止 best-effort `rm` 抹除。
- dry-run 不调用事务模块。

## 测试策略

- 新建故障测试文件，用 Vitest 对 `node:fs/promises` 的 `cp`/`rename` 做单次故障注入，其余调用走真实临时文件系统。
- 第二个 staging copy 失败：两个既有目标都保留旧内容，无 current 内容和 temp 残留。
- 第二个 stage commit 失败：当前目标即时恢复，第一个已提交目标逆序恢复，无 temp 残留。
- 第一个目标 rollback rename 失败：返回包含 commit/restore 两个错误的 `AggregateError`，backup 仍含旧内容。
- 当前提交项即时恢复失败：返回包含 commit/restore 两个错误的 `AggregateError`，当前 backup 仍含旧内容，先前目标恢复。
- 新目标提交后遇到后续 commit failure：逆序删除本次新目标，并恢复后续旧目标。
- staging 清理失败：同时报告原操作与 cleanup 错误，并保留无法删除的 stage 供人工处理。
- destination `access` 返回非 `ENOENT`：在首个 staging copy 前原样失败，旧目标与临时路径均不变。
- 保留现有新安装、force、冲突、dry-run、hook preflight、CLI 和 packed-install 测试。

## 成功标准

- 可控 copy/rename 故障不再造成静默数据丢失或跨客户端半安装。
- 所有成功安装与无故障测试行为不变。
- 恢复失败时仍有可定位、可人工恢复的 backup。
