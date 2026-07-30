# 当前窗口识别与会话选择器设计

## 目标

让用户无需手动寻找 JSONL，同时明确区分“当前 AI 客户端窗口”和“本地最近会话”：

- `trimctx current` 只分析 hooks 绑定的当前窗口。
- 裸 `trimctx` 有绑定时直接分析；无绑定且终端可交互时选择本地会话。
- `trimctx analyze --select` 强制选择，`trimctx analyze --latest` 显式分析最近会话。

不调用 Claude Code `/resume`。外部 CLI 无法可靠读取其选择结果；本地选择器只确定 transcript，不恢复或切换客户端窗口。

## 范围

本次增加严格窗口绑定解析、本地会话轻量发现、交互选择器及 `analyze --select/--latest/--source`。不新增一级命令，不改 `new-chat` fallback，不改 scorer、threshold、safety、report schema 或压缩决策，也不做 Web UI、MCP、LLM、Python、数据库。

## 方案

采用“`current` 严格绑定，扫描能力归入裸命令和 `analyze` 参数”的方案。相比新增 `active` 命令，它不会扩大一级命令面；相比自动调用 `/resume`，它不依赖无法观测的外部交互状态。

## 命令契约

### `trimctx current`

只读取 `TRIMCTX_TRANSCRIPT_PATH`。变量必须非空，路径必须是存在、可读的普通文件。若存在 `TRIMCTX_SESSION_ID`，文件名去掉 `.jsonl` 后必须等于或包含该 ID。失败时不扫描最近文件，提示修复 hooks 或运行 `trimctx analyze --latest`。

`current` 只保留 `--json`、`--color`；移除 `--source`、阈值和 `--compress` 参数。

### 裸 `trimctx`

- 有有效绑定：直接输出用户摘要。
- 无绑定且可交互：扫描已知目录、选择后输出用户摘要。
- 无绑定且不可交互：失败并提示 `<file>` 或 `--latest`。
- 有绑定但绑定无效：报告绑定错误，不 fallback。

测试可用 `TRIMCTX_FORCE_INTERACTIVE=1` 进入交互分支。

### `trimctx analyze`

支持：

```text
trimctx analyze <file>
trimctx analyze                    # 仅有当前绑定时
trimctx analyze --select [--source auto|claude|codex]
trimctx analyze --latest [--source auto|claude|codex]
```

冲突规则：file 不能与 `--select/--latest` 共用；`--select` 与 `--latest` 互斥；`--source` 只允许配合二者；`--select` 必须处于交互环境。`--json`、`--color` 和现有高级阈值继续适用于 analyze。

## 模块边界

`src/sessions/discovery.ts` 提供：

- `resolveBoundSessionFile()`：严格解析当前窗口。
- `listSessions(source)`：扫描并按修改时间降序返回轻量元数据。
- `findLatestSession(source)`：从发现结果选最新文件。
- `resolveCurrentSessionFile()`：为 `new-chat` 保留“绑定优先，否则 latest”的兼容语义。

候选模型包含 `source`、`projectLabel`、`modifiedAt`、`mtimeMs`、`sizeBytes`、`sessionId`、`file`。发现阶段不解析完整 JSONL；Claude 标签取项目根下第一级目录，Codex 标签取 sessions 根下相对父目录，session ID 第一版取文件名。

`src/sessions/picker.ts` 负责渲染编号列表并读取一次选择。空输入默认第 1 项；非整数或越界报错。最多展示最近 20 项。列表、提示和“不会恢复或切换客户端窗口”说明写到 `stderr`，因此 `--json` 的 `stdout` 仍是纯 JSON。

`src/commands/analysis.ts` 只校验参数、选择输入文件并调用现有 `analyzeFile`。

## 数据流

```text
current -> bound resolver ---------------------> analyzeFile
root -> binding -------------------------------> analyzeFile
     -> interactive -> discovery -> picker ----> analyzeFile
analyze <file> --------------------------------> analyzeFile
analyze --latest -> discovery -----------------> analyzeFile
analyze --select -> discovery -> picker -------> analyzeFile
```

## 错误与安全边界

无绑定、无候选、绑定不可读、session ID 不匹配、非交互选择和参数冲突都给出具体下一条命令。发现阶段只读文件元数据，选中后才读取 transcript。原始 JSONL 永不写入；选择 transcript 不代表恢复会话；`current` 和 picker 都不触发压缩。

## 测试

1. discovery 单测覆盖来源过滤、排序、元数据、严格绑定和 ID 校验。
2. picker 单测覆盖格式、默认/指定选择和输入错误。
3. CLI 测试覆盖 current 不 fallback、裸命令 TTY/非 TTY、analyze 两种选择模式和参数冲突。
4. 保留 `new-chat` latest fallback 回归。
5. 最终运行 `npm test`、`npm run build`、`git diff --check`、`npm pack --dry-run --json`。
