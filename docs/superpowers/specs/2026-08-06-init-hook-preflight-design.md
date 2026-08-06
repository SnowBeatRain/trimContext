# Init Hook 跨步骤预检设计

## 背景与根因

`init --with-hooks` 是一个组合操作：先由 `installInitAssets()` 安装 Claude/Codex 资产，再由 `installHooks()` 读取、解析并更新 Claude `settings.json`。资产 installer 已在首个资产写入前预检全部模板和目标冲突，但 hook settings 的可预测错误直到资产已经改变后才被发现。

现有无效 settings 集成测试只断言 settings 原文未被覆盖，没有断言插件目录。按当前顺序，无效 JSON 会使命令失败并保留 settings，却已经创建或替换 `.claude/plugins/trimctx`，形成表面失败但实际半安装的状态。

根因是两个各自安全的 installer 缺少 facade 级跨步骤预检，不是 hook 合并或资产复制逻辑本身错误。

## 目标

- `--with-hooks` 的 settings 读取、JSON 解析和结构校验必须在任何客户端资产写入前完成。
- 无效或不可读 settings 失败时，不创建、不替换 Claude/Codex 资产，也不修改 settings。
- 实际 hook 写入仍在资产安装后重新读取 settings，避免扩大读写竞态窗口。
- 保持现有成功输出顺序、dry-run 文案、hook 合并、`--force`、安装路径和六命令面。
- 不改变 parser、report、scorer、threshold、compression、session 或 transcript 行为。

## 方案比较

### 方案 A：先执行 hook dry-run 预检，再按原顺序写入（采用）

`installHooks(..., { dryRun: true })` 已覆盖 settings 的 ENOENT、读取失败、JSON 解析、结构校验和 hook 计划，而且不创建目录或写文件。facade 在资产 installer 前调用它并保存返回行；真实安装随后仍按“资产 -> hook”顺序执行，hook 写入时重新读取最新 settings。dry-run 命令复用保存的 hook 行，避免重复输出。

该方案只增加一次本地 settings 读取，没有新 API、状态对象或持久化格式。

### 方案 B：先写 hooks，再安装资产

settings 错误可以在资产前失败，但资产复制随后失败时 settings 已经改变，只是把半安装方向反转，因此不采用。

### 方案 C：跨资产与 settings 的完整事务

需要为多个目录与单文件建立 staging、备份、提交和逆序回滚协议，才能覆盖不可预测的运行中 I/O 失败。当前项目明确只要求消除可预测的预检失败，完整事务复杂度与风险不成比例，因此不采用。

## 数据流

`initClientAssets()` 调整为：

```text
解析 client/target/baseDir 和资产计划
  -> 若启用 hooks，调用 installHooks(dryRun=true) 完成 settings 预检
  -> installInitAssets（内部完成全部资产预检后写入，或 dry-run）
  -> 真实安装时调用 installHooks(dryRun=false) 重新读取并原子写入
     dry-run 时直接复用预检返回行
  -> 输出原有摘要与 next steps
```

不启用 hooks 或仅安装 Codex 时不读取 `.claude/settings.json`。

## 错误与隐私

- 沿用 hook installer 的错误：无效 JSON 只报告 settings 路径，不回显内容。
- settings 预检失败发生在 `installInitAssets()` 前，因此不会创建插件/skill 目录。
- dry-run 继续只输出固定的 planned hook 结构，不输出既有 settings、env、permissions 或其他用户配置。
- 实际写入继续使用 `atomicWriteFile()`。

## 测试策略

- 扩展现有“invalid settings 保持原文”进程测试，增加 Claude 插件资产不存在断言；改动前必须 RED。
- 增加 `--client all --with-hooks` 边界，确认同一错误下 Claude 与 Codex 两类资产都未创建。
- 保留成功安装、重复 `--force`、混合 hook group、dry-run 隐私和 packed-install 测试。
- 运行 init/hook 聚焦测试、全量测试、build、package smoke、22-file dry-run 和卫生检查。

## 非目标

- 不为不可预测的复制、rename 或磁盘故障增加跨目标事务回滚。
- 不改变 hook settings schema、管理范围或命令字符串。
- 不改变 `installInitAssets()` 和 `installHooks()` 的独立公开行为。

## 成功标准

- 任一可预测 hook settings 错误发生时，组合 init 的所有目标保持原状。
- 成功和 dry-run 的 stdout 内容与顺序保持不变。
- hooks 未请求时不会新增 settings 读取。
