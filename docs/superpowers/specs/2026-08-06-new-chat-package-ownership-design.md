# New-chat package 目录所有权与失败清理设计

## 背景与根因

`new-chat` 当前先调用 `pathExists(packageDir)`，再执行 `mkdir(packageDir, { recursive: true })`，最后由 `writeFilesDistinctFromInput()` 依次打开并写入五个文件。

这有两个相关问题：

- existence check 与 mkdir 之间存在竞态；递归 mkdir 遇到已存在目录会成功，调用方不能证明 UID 目录由本进程创建。
- 多文件 writer 在后续 open/write 失败时会保留已经创建或写入的文件，使失败命令留下可被误认为完整交接包的 UID 目录。

不能在现有流程外层直接递归删除 `packageDir`，因为竞态创建的目录可能属于其他进程或用户。

## 目标

- UID 最终目录必须通过非递归 mkdir 原子创建，只有创建成功的进程拥有失败清理权。
- 目录已存在时保持既有 `handoff package already exists` 错误，不读取、不修改、不删除其中内容。
- 取得目录所有权后、五个输出全部写入并关闭前的任一进程内失败都尝试删除整个 UID 目录，避免残留半包。
- 清理失败时同时返回原操作错误与清理错误，并保留未删除内容供人工处理。
- 成功路径保持 UID、五文件结构、manifest 路径、stdout 和 transcript 只读契约。

## 非目标

- 不为进程强制终止、断电或操作系统崩溃增加 journal 或下次启动清理。
- 不把共享 `writeFilesDistinctFromInput()` 扩展为支持既有任意文件的通用多文件事务。
- 不改变 handoff、next-context、report、manifest 或 README 内容。
- 不改变 parser、scorer、threshold、safety、compression 或 session 解析。

## 采用方案

1. 保留输出路径与 input alias 预检。
2. 打开并读取 input，在内存中完成 report 与五个输出正文构造；此时尚未创建 UID 目录。
3. 递归创建用户指定的 root directory。
4. 用 `mkdir(packageDir)` 非递归原子取得 UID 目录所有权。
5. 若 mkdir 返回 `EEXIST`，转换为既有冲突文案；其他错误原样传播，且不执行清理。
6. 只有第 4 步成功后才调用多文件 writer。
7. 多文件 writer 完成前的任一错误都对本进程拥有的 packageDir 执行递归删除；删除成功后抛原错误，删除失败时抛 `AggregateError([operationError, cleanupError])`。
8. writer 已成功返回后 package 即视为完整；后续 stdout 或 input-handle close 错误不删除有效 package。

root directory 可能在失败后保持为空；它是用户明确指定或默认的容器路径，不被视为完整 UID 工件，也不递归删除，避免扩大清理范围。

## 方案取舍

- 隐藏 stage 目录整体 rename 会让最终 UID 只在成功时可见，但 Node 标准 rename 没有跨平台 no-replace 目录语义，不能可靠保护竞态创建的空目标目录。
- 通用多文件事务需要处理既有输出的 backup、rollback 和恢复失败，超出随机 UID 新目录的所有权模型。
- 独占 mkdir + 所有权内清理不能覆盖硬终止，但能覆盖可测试的 open/write/runtime failure，且删除权限边界清晰。

## 错误与清理语义

- input 读取或 report 构造失败发生在 packageDir 创建前，不产生 UID 工件。
- `EEXIST` 表示未取得所有权，不执行清理。
- 写入失败且清理成功：原错误保持为顶层失败。
- 写入失败且清理失败：两个错误都保留在 `AggregateError.errors`，残留目录可供人工定位。
- transcript 只通过只读 handle 读取，清理范围固定为本进程刚刚创建的 UID packageDir。

## 测试策略

- 通过 in-process Commander 注册调用真实 `new-chat`，仅对第二个输出的 `open` 注入失败；确认 RED 时旧实现残留 UID 目录和首个输出。
- 修复后相同故障返回原错误，root 下不残留 UID 目录，input 内容不变。
- 注入 packageDir cleanup failure，确认返回同时包含 write/cleanup 的 `AggregateError`，残留目录仍可定位。
- 模拟竞态方创建 packageDir 并让 mkdir 返回 `EEXIST`，确认 marker 保留且不调用 cleanup。
- 在 output root 预置 sibling package，确认本次写失败只删除 owned UID，不修改 sibling 内容。
- 保留现有默认输出、自定义 `--out`、当前窗口 binding、latest fallback、manifest 和六命令回归。

## 成功标准

- 可控进程内写入失败不再留下半成品 UID package。
- 只有成功原子创建 UID 目录的调用方能够删除它。
- 清理失败不覆盖原始失败，也不删除 root 或其他 package。
- 公开命令和分析/压缩安全契约不变。
