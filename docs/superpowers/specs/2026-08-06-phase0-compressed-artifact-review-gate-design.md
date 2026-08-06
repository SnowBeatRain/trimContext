# Phase 0 Compressed Artifact Review Gate 设计

## 背景与根因

`phase0:run` 会在每个 `compress` 子进程成功后检查目标 `.trimmed.jsonl` 是否存在、是普通文件且可打开读取，并把 `compress.ok` 与 `output_file` 写入 results v2。`phase0:review` 目前只信任 `compress.ok`：它不扫描实际 compressed artifacts，也不验证 `aggregate.failed_samples`。

因此，batch 后删除全部 `.trimmed.jsonl`、留下失败样本的陈旧输出，或局部编辑 `failed_samples`，都不会影响 trust gate。只要 results 中的布尔计数、report 证据和人工标签通过，review 仍可能得到 `locked`。

## 目标

- review 重新枚举 reports 目录中实际存在、为普通文件且可打开读取的 `*.trimmed.jsonl`。
- 成功 compress 的 expected artifact ID 集合必须与实际可用 artifact ID 集合完全一致。
- 重复 compressed ID、缺失/额外/不可读/非普通 compressed artifact 均阻止 trust 锁定。
- `aggregate.failed_samples` 必须与逐样本 `analyze/report/compress/input_unchanged` 重算结果按顺序精确一致。
- results 中的 sample 路径必须唯一，防止重复记录抬高 sample count。
- review JSON/Markdown 只输出 compressed artifact 匹配计数和固定 issue code，不输出路径、artifact ID 或正文。
- 保持 `trimctx.phase0.results.v2`、review v2、产品 CLI、评分与压缩行为不变。

## 方案比较

### 只校验 `failed_samples`

这能发现一部分 aggregate 局部编辑，却仍允许所有 compressed artifacts 缺失或遗留陈旧文件，不解决实际 artifact 门。

### 立即记录 compressed SHA-256 并升级 results schema

digest 能检测同名 artifact 的字节漂移，但不证明其压缩语义正确，也不证明 protected/candidate 行为与 report 一致。单独增加 hash 容易被误解为完整压缩安全验证，并要求 evidence schema 迁移。本轮不采用；未来若绑定 compressed 内容，应与语义对账一起设计。

### 校验实际集合、文件类型、可读性与 aggregate 一致性

采用此方案。它直接复核当前 `compress.ok` 的既有成功契约，能发现缺失、额外、目录占位和不可读 artifact，同时不加载或传播可能敏感的 compressed 正文。results v2 无需迁移，风险边界清晰。

## Evidence 数据结构

`ValidationResult` 增加可选 `compressedId`。当 `compress.ok === true` 时，normalization 必须要求：

```ts
typeof value.compress.output_file === "string"
value.compress.output_file.endsWith(".trimmed.jsonl")
basename(value.compress.output_file, ".trimmed.jsonl") !== ""
```

`ValidationEvidence` 增加：

```ts
expected_compressed_artifacts: number;
matched_compressed_artifacts: number;
```

`loadPhase0ValidationEvidence()` 新增第三个参数：

```ts
actualCompressedArtifacts: ReadonlySet<string>
```

expected IDs 来自 `compress.ok === true` 的规范化 results。实际集合来自 review 对 reports 目录的独立扫描。

## Review 扫描行为

review 对 reports 目录只枚举一次 `Dirent[]`：

- `*.report.json` 保持现有 Buffer 解析、SHA-256、source/input 提取。
- `*.trimmed.jsonl` 只有 `Dirent.isFile()` 且 `open(..., "r")` 与 `close()` 都成功时才进入实际集合。
- 目录、symlink、不可打开或无法关闭的目标不进入集合；最终通过 `compressed_set_mismatch` 聚合，不把 OS 错误、路径或正文写入 review artifacts。
- 没有读取或解析 compressed 内容，因此不会扩大隐私输出面或宣称 JSONL 语义已验证。

## 集合与重复规则

- expected ID 列表含重复项：`duplicate_compressed_ids`。
- expected set 与 actual set 不相等：`compressed_set_mismatch`。
- `matched_compressed_artifacts` 为 expected unique IDs 与 actual IDs 的交集数量。
- actual 中成功 result 未声明的额外 `.trimmed.jsonl` 也触发 mismatch，防止失败样本的陈旧 artifact 混入审计目录。
- results sample 路径重复：`duplicate_samples`，避免 sample count 与 `failed_samples` 歧义。

## `failed_samples` 一致性

逐样本失败条件继续复用 run 的定义：

```ts
!inputUnchanged || !analyzeOk || !reportOk || !compressOk
```

按 results 原顺序重算 sample path 数组。`aggregate.failed_samples` 必须是字符串数组并逐项精确相等；缺失、额外、重复或重排都归入既有 `aggregate_mismatch`。review 输出不包含这些路径。

真实执行失败且 aggregate 一致时仍属于 quality gate：结构完整、coverage ready 时返回 `failed`。aggregate 自相矛盾属于 readiness evidence 问题：`review_required`。

## 隐私与兼容边界

- review v2 只增加两个数字，不包含 compressed 文件名、路径、内容或文件错误。
- results v2 继续私有；合法现有 v2 evidence 无需迁移。
- 不对 compressed bytes 计算或记录 digest，不验证 JSONL 语法、消息集合或 protected 语义。
- 不修改 `compress` 命令、输出字节、scorer、threshold、candidate decision 或原 transcript。
- 本门检测本地 audit artifact 漂移，不是签名或对抗同时重写 evidence/artifacts 的机制。

## 测试策略

- evidence：完整五样本中移除一个 expected compressed ID 并加入一个 stale ID；断言 matched 4/5、`compressed_set_mismatch`，输出不含 ID。
- evidence：results 有重复 sample 或重复 compressed output basename；断言固定重复 issue。
- evidence：篡改 `aggregate.failed_samples`，即使计数正确也必须 `aggregate_mismatch`，输出不含路径。
- review 集成：可锁定 fixture 不写任何 `.trimmed.jsonl`；旧实现错误 `locked`，新实现为 `review_required`、0/5 和固定 issue。
- review 对照：一个真实 compress failure 只写四份成功 artifact，集合匹配仍 ready，最终保持 `compress_success_rate_below_gate` / `failed`。
- 完成 Phase 0 聚焦、全量、build、packed/fresh-install、22-file pack 与 sanitized batch/review artifact 扫描验证。

## 成功标准

- missing、stale、non-regular 或 unreadable compressed artifact 不再能锁定 trust。
- `failed_samples` 不再能与逐样本结果矛盾而保持 ready。
- 合法 batch 与真实 execution failure 的既有状态语义保持。
- 输出继续满足隐私收敛，且不夸大 compressed 内容安全保证。
- Phase 0 仍未锁定。
