# Atomic write cleanup 错误与残留证据设计

## 背景与根因

`src/platform/files.ts` 的 `writeAtomicFile()` 在同目录临时文件完成写入后执行 commit，并在 `finally` 中关闭仍打开的 temp handle、删除 temp path。当前两个 cleanup 调用都使用 `.catch(() => undefined)`，因此清理失败被无条件吞掉。

当 commit、input snapshot 或其他主操作先失败，随后 temp 删除也失败时，调用方只看到主错误，不知道隐藏 `.trimctx-*.tmp` 仍保留 settings、CLAUDE.md、report 或未脱敏 export 内容。handle close 与 rm 同时失败时也没有完整因果链。

## 目标

- 主操作失败与 cleanup 失败同时发生时，保留全部错误，不让 cleanup 覆盖或隐藏主错误。
- handle close 与 temp rm 必须都尝试，单项失败不短路另一项清理。
- temp path 只有在 exclusive open 成功后才归本次调用所有；open 失败不得删除该路径。
- commit rename 成功后 temp path 所有权已随内容转移到 output，不再对旧随机名执行 rm。
- 无法删除的 temp 文件保持原位，供用户根据错误路径人工处理。
- 已有 Windows output backup/restore 错误继续保留并在聚合时展平。
- 成功写入、input identity/snapshot、输出内容和公开命令行为不变。

## 非目标

- 不为强制终止、断电或操作系统崩溃增加 journal 或启动时扫描。
- 不自动读取、回显或恢复残留 temp 正文。
- 不改变 `writeFilesDistinctFromInput()` 的多输出语义。
- 不改变 parser、report schema、scorer、threshold、safety 或 compression。

## 采用方案

`writeAtomicFile()` 增加主操作失败状态：

```ts
let operationFailed = false;
let operationError: unknown;
let ownsTempPath = false;
```

exclusive open 成功后设置 `ownsTempPath = true`；直接 rename 或 Windows replacement 成功后立即设置为 false。外层 catch 记录原错误并原样继续抛出。finally 不再吞错，而是：

1. 若 temp handle 仍存在，尝试 close，失败加入 cleanupErrors。
2. 无论 close 是否失败，只在 `ownsTempPath` 仍为 true 时尝试 `rm(tempFile, { force: true })`，失败加入 cleanupErrors。
3. cleanupErrors 为空时不改变原控制流。
4. cleanupErrors 非空时抛出 `AggregateError`；若主操作已失败，errors 顺序为主错误 components、close errors、rm errors；否则只包含 cleanup errors。

对嵌套 `AggregateError` 递归或按当前产生路径平铺，确保 Windows commit/restore 错误仍可直接检查，不作为单个嵌套对象隐藏。

## 错误与数据边界

- 错误消息只包含操作系统错误与本地路径，不读取或复制 temp 正文。
- cleanup 失败时不得额外删除 output、backup 或父目录。
- exclusive open 未成功或 commit 已转移所有权时，不得删除随机 temp 名后来出现的其他文件。
- temp rm 失败保留 temp 作为可定位证据；测试只在临时目录中读取验证，产品错误不回显正文。
- cleanup 成功时仍抛原主错误，保持既有错误身份和上层兼容性。

## 测试策略

- 对普通 `atomicWriteFile()` 注入 commit rename failure 与 temp rm failure。
- 在 mocked exclusive open 内创建 foreign sentinel 后抛 `EEXIST`，确认 sentinel 保留且 cleanup 不调用 rm。
- 对新 output 成功 commit，确认 rename 后不再调用 temp rm。
- 注入首次 handle close、cleanup close 与 temp rm 三连失败，确认三个错误全部平铺且 rm 未被 close error 短路。
- Windows replacement 已移动 temp 后注入 backup cleanup failure，确认保留 backup 且不再 rm 旧 temp 名。
- 确认旧实现 RED：只返回 commit error，不是 `AggregateError`，同时 temp 实际残留。
- 修复后确认 errors 同时包含 commit/cleanup，既有 output 内容不变，残留 temp 含新数据。
- 用真实 rm 在测试 finally 清理临时目录，避免故障证据污染系统 temp。
- 保留 ordinary atomic write、input-distinct atomic write、hook installer/storage、report/export 和 CLI 回归。

## 成功标准

- 进程内 cleanup 失败对调用方可见，且不覆盖主失败。
- 所有可执行 cleanup 均被尝试。
- 既有目标与 input 保持不变，无法删除的 temp 保留且可定位。
- 成功路径与发布资产不变。
