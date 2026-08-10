# trimctx Security Hardening Design

## Goal

修复当前审查确认的压缩误删、凭据泄漏、Claude hook 命令解析、安装脚本目录所有权、settings 并发覆盖和自动 hook 资源耗尽问题，同时保持 scorer、threshold、Report v2、六命令公开面和原 transcript 只读契约不变。

## Safety Decisions

- 任一规范化 message ID 重复时，公共分析仍可报告，但 `compress` 必须在创建或替换输出前 fail closed。
- 不尝试根据重复 ID 猜测删除对象，也不降低 protected、recent window 或 candidate 判定标准。
- 所有可持久化的人类可读摘要使用同一脱敏实现；完整 JSON report、export 和 new-chat 继续遵循现有“可能包含原文和秘密”的契约。
- Claude hooks 必须调用安装时确定的绝对 Node 和 CLI 入口，不依赖项目工作目录或 `PATH` 查找 `trimctx`。
- GitHub 安装脚本不得递归删除无法证明属于 trimctx 的目录。
- 并发修改优先保留外部写入并让本次操作失败，不自动 merge 或覆盖。
- 资源限制只保护自动 hook 和明显超出本地 CLI 能力的输入，不改变正常样本分析语义。

## Architecture

### Compression Identity Guard

在核心分析边界提供 message ID 唯一性校验。`compressFile()` 在分析完成、构造删除集合之前调用该校验；重复 ID 错误只报告固定计数，不回显消息正文。输出文件尚不存在时不得创建，已存在时必须逐字节保留。

压缩的现有删除条件保持不变：只有非 protected、`remove_candidate`、reasons 非空且具有高置信 decisive evidence 的消息可删除。唯一性校验是该条件之前的额外安全门。

### Shared Redaction

新增共享的纯文本脱敏模块，集中处理：

- OpenAI/GitLab/Slack 等现有带连字符 token；
- GitHub `ghp_...`、`github_pat_...` 及同族格式；
- Authorization Bearer/Basic；
- credential URL、email 和 key/value secret。

Markdown 报告、review queue 摘要、resume evidence 和 CLAUDE.md 状态块改用该模块。各调用方继续负责自身的 Markdown 转义、长度限制和 marker 中和。

### Absolute Claude Hook Commands

hook settings planner 接收显式的 SessionStart/Stop command。真实 `init --with-hooks` 根据 `process.execPath` 和 package root 下的 `dist/cli.js` 生成当前平台可执行的绝对命令；路径含控制字符或无法安全引用时 fail closed。

纯 settings 测试通过注入命令保持确定性。`--force` 只移除与当前绝对命令或已知旧版裸 trimctx 命令精确匹配的 hook entry，用于安全迁移且不删除同组用户 hook。

### Installer Ownership

`install.ps1` 和 `install.sh` 对 checkout 与插件目录采用不同所有权证据：

- checkout 不存在时允许 clone；已存在时必须是 git checkout，且 `origin` 与请求的仓库 URL 一致；其他现有目录一律拒绝，不再删除；
- 插件目录不存在时允许安装；已存在时必须包含合法 marker，或符合旧版 trimctx 插件的最小结构指纹，并在本次成功安装后迁移 marker。

目标为空、文件系统根、用户主目录、marker 不匹配或只是同名普通目录时拒绝操作。PowerShell 不再删除任意非 git `$InstallDir`，也不对未经验证的 git checkout 执行强制 checkout。

### Conditional Settings Persistence

hook installer 读取 settings 时同时保留精确原始字节或“不存在”状态，写入时使用现有 `atomicWriteFileIfUnchanged()`。从读取到提交期间目标被创建、删除或字节变化时，安装失败并保留当前 settings。

### Hook Resource Limits

hook stdin 上限固定为 1 MiB，超过上限立即停止读取并返回固定错误。Stop hook transcript 上限固定为 64 MiB 和 10,000 条规范化消息：读取前检查普通文件和大小，在读取后的同一 Buffer 上再次验证字节数，解析后在进入 safety/scorer 前验证消息数。

这些限制只作用于自动 SessionStart/Stop hook；显式 CLI 本轮保持现有输入能力。超过限制时不更新环境文件或 `.claude/CLAUDE.md`，不打印正文，不改变 transcript。现有二次复杂度信号算法本轮不调整，以避免改变评分结果。

## Error Handling

- 安全门错误使用固定分类和必要路径，不包含消息正文、token 或原始 hook stdin。
- 重复 ID、资源超限、并发 settings 变化和未知安装目录均在任何不可恢复写入前失败。
- 已有原子写、backup/restore 和 AggregateError 语义保持不变。

## Testing

每个行为按 RED-GREEN 顺序实现：

1. 重复 Claude `uuid` 中一个 candidate、一个 protected 时，`compress` 失败且输入/既有输出不变。
2. Markdown、resume 和 context state 对合成 `ghp_...`、`github_pat_...` 值不泄漏。
3. hook settings 真实安装结果不包含裸 `trimctx hook`，绝对入口正确引用。
4. 安装脚本拒绝未知目录并允许 marker/旧版结构迁移；测试只操作受控临时目录。
5. settings 在读取后被并发修改时拒绝提交并保留外部字节。
6. hook stdin 与 Stop transcript 超限时失败且没有持久化副作用。
7. 用可注入 `Phase0CliRunner` 确定性模拟“compress 退出 0 但未创建产物”，并移除依赖跨进程轮询删除文件的时序敏感测试。

最终质量门：聚焦测试、`npm test`、`npm run build`、`git diff --check`、生产依赖 audit、package contents/fresh-install smoke。

## Non-goals

- 不调整 scorer、threshold、protected 规则或 candidate 范围。
- 不引入数据库、LLM、MCP、Web UI、后台服务或持久化锁。
- 不把 export、完整 JSON report 或 new-chat 改成默认脱敏产物。
- 不创建提交、推送或发布。
