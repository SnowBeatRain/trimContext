# Phase 0 输入证据绑定设计

## 背景与根因

`phase0:run` 为每个样本记录 `sample`、`input_sha256_before`、`input_sha256_after` 和 `input_unchanged`。run 阶段会真实计算两次 hash，并在 analyze/report 验证时要求 Report v2 `input.file` 与当前 sample 精确相等。

`phase0:review` 当前只读取 `input_unchanged` 布尔值，不校验两个 hash 字段，也完全忽略 `sample`。因此 evidence 可以把一个真实的输入变化从 `false` 改成 `true` 并同步 aggregate，或把成功 report 关联到另一 sample 路径；只要 report ID/hash/source 与人工标签仍通过，就可能错误得到 `locked`。

## 目标

- results v2 的每个样本必须包含合法 lowercase SHA-256 before/after 字段。
- `input_unchanged` 必须严格等于 before/after hash 是否相同。
- review 从实际 report 字节读取 `input.file`，并与同一成功 result 的 `sample` 精确匹配。
- sample/report input 不匹配产生固定 `report_input_mismatch` 并阻止锁定。
- review JSON/Markdown 增加 `matched_report_inputs` 聚合数，不输出路径或 hash。
- genuine input mutation 继续产生现有 `input_mutation_detected` 和 `failed`；畸形或自相矛盾 evidence 继续归为 `invalid_phase0_results` / `review_required`。
- 不改变 results v2、scorer、threshold、protected、candidate decision、compression 或六命令公开面。

## 方案比较

### 继续信任 `input_unchanged`

布尔值没有独立约束，无法区分 runner 真实计算结果与后续误编辑，不解决根因。

### review 重新读取原 transcript

review 可能在 batch 后很久执行，原 transcript 可能继续增长、移动或不可用。重新 hash 会把运行后的正常变化与 batch 期间写入混为一谈，也扩大对私有输入的读取范围，因此不采用。

### 校验 evidence 内部一致性并绑定 report input

采用此方案。before/after digest 是 batch 当时的快照证据；验证其格式和等价关系可以发现只翻转布尔值或损坏字段。实际 report 的 `input.file` 已由 report digest 绑定，和 results `sample` 对账则能证明该成功 report 仍关联同一 batch 输入声明。

该机制不是签名：能同时重写 results、report 和 digest 的主体仍可构造一致证据。目标是发现偶然漂移、局部编辑和实现回归。

## Results v2 normalization

`normalizeResult()` 新增必需条件：

```ts
typeof value.sample === "string" && value.sample.length > 0
SHA256.test(value.input_sha256_before)
SHA256.test(value.input_sha256_after)
value.input_unchanged === (before === after)
```

任一条件失败返回 `undefined`，顶层 evidence 使用既有 `invalid_phase0_results`，不回显 sample、digest 或非法值。

规范化结果保存：

```ts
sample: string;
inputUnchanged: boolean;
```

input unchanged 计数继续从规范化布尔值生成；因为它已受 digest 等价关系约束，aggregate mismatch 和 mutation gate 语义保持稳定。

## Report input binding

`Phase0ReportArtifact` 增加：

```ts
inputFile?: unknown;
```

review 从同一已解析 report 对象读取 `input.file`。evidence 为每个成功 report ID 建立 expected sample map，并计算：

```ts
matched_report_inputs: number;
```

实际 artifact 存在但 `inputFile !== result.sample` 时加入 `report_input_mismatch`。缺失 artifact 仍由 `report_set_mismatch` 表示；不额外回显路径。匹配只使用精确字符串，不做 basename、大小写、`realpath` 或 inode 等价。

## Issue 与状态语义

- invalid/missing digest、空 sample、布尔与 digest 矛盾：`invalid_phase0_results`，`review_required`。
- 合法 evidence 明确记录 before/after 不同且 `input_unchanged:false`：`input_mutation_detected`，结构完整时为 `failed`。
- report ID/hash/source 可匹配但 sample 与实际 report input 不同：`report_input_mismatch`，`review_required`。
- source 和 input mismatch 可以同时出现；输出只含固定 issue code 和聚合匹配数。

## 非目标

- 不在 review 阶段重新打开或 hash 原 transcript。
- 不为 compressed artifact 新增 digest 或 input binding。
- 不校验 analyze/report summary 深度一致性。
- 不提供数字签名、密钥管理或对抗同时篡改所有 evidence 的保证。
- 不改变合法 report、人工标签、指标或阈值。

## 测试策略

- evidence：before/after 不同但 `input_unchanged:true`，即使 aggregate 同步也必须返回 `invalid_phase0_results`，且不泄露 digest 哨兵。
- evidence：ID/hash/source 全匹配，但一个 result sample 与实际 report input 不同；断言 `matched_report_inputs` 降低和 `report_input_mismatch`。
- review 集成：完整可锁定 evidence 的五个 results sample 与实际 report input 全部错绑；旧实现错误 `locked`，新实现必须 `review_required` 且匹配 0/5。
- genuine input mutation 既有用例继续得到 `failed` 和 `input_mutation_detected`。
- 完成聚焦、全量、build、packed/fresh-install、22-file pack 与 sanitized end-to-end 验证。

## 成功标准

- 局部翻转 `input_unchanged` 或错绑 sample 不再能锁定 Phase 0 trust。
- 合法 results v2 无需迁移，真实输入变化的现有失败语义保持。
- review artifact 不暴露 sample path 或 input digest。
- Phase 0 仍未锁定，不扩大自动压缩安全承诺。
