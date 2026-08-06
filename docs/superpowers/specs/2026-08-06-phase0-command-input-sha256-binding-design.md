# Phase 0 命令输入 SHA-256 绑定设计

## 背景与根因

`phase0:run` 当前先计算一次 `input_sha256_before`，随后依次启动 `analyze --json`、`report` 和 `compress` 三个独立子进程，最后再计算 `input_sha256_after`。每个子进程都会重新按路径打开输入，因此首尾哈希与三次命令实际消费的字节不是同一个读取快照。

受控探针已经复现：输入最初为 A，首次哈希后临时替换成 B，三条命令都处理 B，再在末次哈希前恢复 A。现有结果会同时得到 before/after 相等、analyze/report 语义相等、report/compress 对应且 `sample_ok: true`。根因是批次只证明“首尾路径内容相同”，没有证明“每条命令消费的字节具有首次记录的摘要”。

## 目标

- 将三条 Phase 0 子命令实际消费的输入字节绑定到首次记录的 SHA-256。
- 校验与解析必须使用同一个 Buffer，不能先哈希后重新打开路径解析。
- 输入在任一命令读取时不匹配，命令必须 fail closed，且不得写入新的 report 或 compressed artifact。
- 保持六命令公开面、Report v2、results v2、review v2、scorer、threshold 和压缩决策不变。
- 新 results v2 必须明确声明命令输入绑定已启用；旧 results v2 缺少该证据时只能保持 `review_required`。
- 错误和 review 输出不得暴露输入内容、实际摘要、预期摘要或额外私有路径。

## 方案比较

### 临时文件快照

把 A 复制到临时文件后运行三条命令可以得到稳定字节，但 Report v2 的 `input.file` 会变成临时路径。若额外引入“读取路径”和“报告路径”双路径接口，会扩大 CLI/pipeline 契约，并增加私有原文副本的创建、权限和清理风险，因此不采用。

### 每条命令前后重新哈希原路径

该方案能捕获持续变化和命令间变化，却仍无法发现一次命令内部发生的“替换为 B、解析 B、恢复 A”，没有消除根因，因此不采用。

### 将首次摘要绑定到每条命令实际读取的 Buffer

采用此方案。runner 通过仅供内部 Phase 0 协调使用的环境变量把首次 SHA-256 传给每个子进程。`analyze`、`report` 和 `compress` 都先把各自已经打开的输入读为 Buffer，对该 Buffer 计算摘要并校验，再从同一个 Buffer 解码和解析。路径和报告契约不变，也不产生原文副本。

## 组件边界

### 输入完整性模块

新增 `src/core/input-integrity.ts`，只负责：

- 定义内部环境变量名 `TRIMCTX_PHASE0_EXPECT_INPUT_SHA256`；
- 读取并验证可选的 lowercase 64 位 SHA-256 期望值；
- 对实际读取的 Buffer 计算 SHA-256；
- 缺少期望值时保持普通 CLI 行为；
- 非法期望值或摘要不匹配时抛出固定、隐私安全的错误。

该模块不读取文件，不解析 JSONL，也不关心命令类型。

### 命令读取边界

- `analyzeFile()` 改为读取 Buffer，校验后再 `toString("utf8")` 并调用现有 `analyzeInput()`。
- `report` 继续复用现有只读 file handle；从该 handle 读取 Buffer，校验后再解析，校验失败发生在任何输出写入之前。
- `compressFile()` 继续复用现有只读 file handle 和输入 stat；从该 handle 读取 Buffer，校验后再解析和生成输出，校验失败发生在原子输出写入之前。

普通 CLI 进程没有内部环境变量时不增加额外摘要计算，现有行为保持不变。

### Phase 0 runner

`Phase0CliRunner` 增加第三个 `expectedInputSha256` 参数。`validatePhase0Sample()` 只计算一次首次摘要，并把同一个值传给三次 runner 调用。真实 runner 只在对应子进程环境中设置内部变量，不修改父进程环境，也不把摘要放进命令行参数或公开帮助。

末次 `input_sha256_after` 仍然保留：子命令 Buffer 绑定证明输出基于 A，末次摘要证明批次结束时原路径也回到 A。二者职责不同。

## Results 与 review 证据

每个新 results v2 sample 增加：

```json
{
  "input_sha256_bound": true
}
```

aggregate 增加：

```json
{
  "input_sha256_bound": 6
}
```

布尔值表示当前 runner 已把 `input_sha256_before` 作为强制期望值传入全部三条本地源码 CLI 子进程。它不替代 before/after 摘要，也不是数字签名。

review 对 results v2 采用兼容读取：

- 全部 sample 都是 `true` 且 aggregate 精确匹配时，输入命令绑定证据可用；
- 旧 v2 缺少 sample 字段或 aggregate 时，加入 `input_sha256_binding_unavailable`，保持 `review_required`；
- sample 字段存在但不是 `true`，或 aggregate 不是范围内整数时，返回 `invalid_phase0_results`；
- aggregate 格式合法但与 sample 计数不一致时，加入现有 `aggregate_mismatch`；
- review v2 validation 增加聚合计数 `input_sha256_bound`，JSON/Markdown 只输出计数，不输出摘要。

不升级 schema version，沿用当前为 results v2 增加兼容证据字段的模式。

## 失败语义

- 内部期望摘要格式非法：CLI 失败，固定错误 `Invalid Phase 0 input SHA-256 expectation`。
- 实际 Buffer 摘要不匹配：CLI 失败，固定错误 `Input changed during Phase 0 validation`。
- analyze 不输出报告；report/compress 在校验前不写新目标。
- runner 继续执行同一 sample 的剩余命令并写最终批次证据；失败命令保持现有 `ok: false`，sample 进入 `failed_samples`。
- 若旧目标已存在，失败子进程不会把它计为本轮成功 artifact；沿用现有“不检查失败命令的陈旧目标”规则。

## 威胁边界

该设计关闭正常文件竞争和非对抗性临时改写造成的 TOCTOU：只要命令消费的字节不同于 A，就会失败。它依赖 SHA-256 的抗碰撞性，不提供数字签名，也不防止能够同时修改源码、子进程环境和 results/report/labels 全部证据的主体伪造完整批次。

输入在命令未读取期间短暂变化后恢复不影响输出，因此不视为失败。路径被替换但命令读取到与 A 完全相同的字节也不影响语义。review 仍不重新打开原 transcript。

## 测试策略

- runner 单元回归：断言三次 `Phase0CliRunner` 都收到同一个首次 SHA-256，新结果包含 sample/aggregate 绑定证据。
- CLI 集成回归：分别对 `analyze --json`、`report` 和 `compress` 注入错误期望摘要，断言退出非零、固定错误不泄露摘要，report/compress 不创建新目标。
- 匹配路径：带正确期望摘要运行三条命令，断言现有输出契约不变。
- core 回归：非法内部摘要格式 fail closed；无环境变量时保持普通调用行为。
- review 回归：旧 v2 缺证据为 unavailable；非法 present 字段为 invalid；aggregate 漂移被拒绝；完整新证据计数匹配。
- 运行 Phase 0 聚焦测试、严格脚本 TypeScript、全量测试、build、packed/fresh-install、npm dry-run 和 sanitized Phase 0 端到端链路。

## 成功标准

- 受控 A/B/A 场景不再可能得到三条命令成功和 `sample_ok: true`。
- 三条成功命令的输出只能来自与 `input_sha256_before` 相同的实际字节。
- 旧 results v2 不会被错误视为具备命令输入绑定保证。
- 无 Phase 0 内部环境变量的普通 CLI 输出、错误、性能路径和公开帮助不变。
- 原始 transcript 始终只读，不生成持久原文快照。
