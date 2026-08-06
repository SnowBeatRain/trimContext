# Phase 0 report artifact 身份绑定设计

## 背景与根因

`phase0:run` 会在 report 子进程退出后读取 `*.report.json`、验证最小 `trimctx.report.v2` 契约，并把成功状态写入 `phase0-results.json`。`phase0:review` 随后读取同目录报告和 batch evidence，但当前只比较成功 report 的 basename 集合。

这能发现缺失、额外或改名报告，却不能证明 review 使用的是 run 已验证的同一份字节。同名报告在两个阶段之间被意外覆盖、格式化或替换后，只要仍满足 message/label 最小门，就可能继续得到 `locked`。根因是 batch evidence 记录了路径身份，却没有记录 artifact 内容身份。

## 目标

- `phase0:run` 为每个成功且通过最小契约校验的 report 记录精确字节 SHA-256。
- `phase0:review` 对实际解析并用于人工指标的同一份字节重新计算 SHA-256。
- report ID 集合与 SHA-256 必须同时匹配，Phase 0 trust 才可能锁定。
- mismatch 只输出聚合计数和固定 issue code，不输出 digest、路径、message ID 或正文。
- 旧 evidence 不能在缺少内容身份的情况下继续锁定 trust，并得到明确迁移原因。
- 不改变 scorer、threshold、protected、candidate decision、compression 或六命令公开面。

## 非目标

- 不提供数字签名、密钥管理或对抗能同时重写 report 与 evidence 的攻击者。
- 不判断两个 JSON 是否语义等价；空白、字段顺序等任何字节变化都表示 artifact 已不是原验证对象。
- 不对 compressed artifact 增加身份绑定；它不参与人工标签和 trust 指标计算，本轮保持现有可读性门。
- 不把 Phase 0 开发脚本加入 npm 发布包。
- 不改变 `trimctx.phase0.review.v2` 的状态枚举或人工数值阈值。

## 方案比较

### 仅继续扩展 report 结构校验

结构校验只能证明当前 report 可解释，不能证明它就是 batch run 已验证的 artifact。同名、同结构替换仍可通过，不解决根因。

### run 单边记录 SHA-256

记录 digest 便于人工排查，但 review 若不对实际读取字节重算并比较，trust gate 仍不受约束。

### run/review 端到端绑定

采用此方案。run 在验证 report 时记录摘要；review 从用于 JSON.parse 的同一 Buffer 计算摘要；evidence 模块比较 ID 与摘要。这形成最短的端到端证据链，同时保持摘要值只存在于私有 `phase0-results.json`。

## Results v2

`phase0:run` 输出 schema 升级为：

```json
{
  "schema_version": "trimctx.phase0.results.v2",
  "results": [
    {
      "report": {
        "ok": true,
        "report_file": ".../sample.report.json",
        "report_sha256": "64 lowercase hex characters"
      }
    }
  ]
}
```

规则：

- `report.ok === true` 时，`report_file` 和 `report_sha256` 都是必需字段。
- `report_sha256` 必须匹配 `/^[a-f0-9]{64}$/`。
- report 子进程失败或 artifact/contract 校验失败时，hash 字段省略。
- hash 对 `validateReportArtifact()` 已读取并成功解析、通过最小契约的原始 Buffer 计算；不再为 hash 二次读取文件。
- input SHA-256 字段及 aggregate 结构保持不变。

这是证据契约的实质升级，因此不沿用 v1。`phase0:review` 遇到 v1 时返回 `available: true`、`ready: false`、固定 issue `report_integrity_unavailable`，要求重新运行 batch validator。其他未知 schema 或 malformed v2 继续使用 `invalid_phase0_results`。

## Review 数据流

`loadReports()` 对每份 report 只读取一次 Buffer：

1. 从 Buffer 解码 UTF-8 并 JSON.parse。
2. 验证顶层 `messages` array。
3. 把 messages 保存到既有 per-sample map。
4. 对同一 Buffer 计算 SHA-256，保存到 per-sample digest map。

`loadPhase0ValidationEvidence()` 接收实际 report digest map，而不是只有 ID set。它从 results v2 重算预期 ID/digest map，并输出：

```ts
interface ValidationEvidence {
  // existing fields unchanged
  expected_reports: number;
  matched_reports: number;
  matched_report_hashes: number;
  issues: string[];
}
```

- `matched_reports` 继续表示同名 report 数。
- `matched_report_hashes` 表示 ID 和 SHA-256 都相同的 report 数。
- ID 集合不同产生 `report_set_mismatch`。
- 同一 ID 存在但 SHA-256 不同产生 `report_hash_mismatch`。
- 两项可以同时出现；都属于 evidence readiness 问题，因此最终为 `review_required`，不是 scorer/execution `failed`。

review JSON/Markdown 只输出匹配数和 issue code，不输出 digest。`phase0-results.json` 仍是私有 artifact。

## 失败与隐私语义

- report 在 run 验证之后、review 之前发生任何字节变化：`report_hash_mismatch`。
- v2 中成功 report 缺失或包含非法 digest：`invalid_phase0_results`。
- v1 evidence：`report_integrity_unavailable`。
- report 当前不可读或 JSON malformed：沿用 review 现有稳定错误并在提交输出前失败。
- hash mismatch 不回显预期值、实际值、report ID 或路径。

本机制检测 evidence 与 report 的意外漂移，不提供认证。能同时编辑两者的主体可以重算 digest，因此文档不得使用“防篡改”或“加密真实性”表述。

## 测试策略

- `phase0-run-sample`：写入包含换行/缩进的合法 report，断言成功结果记录原始字节 SHA-256；失败 report 不记录 hash。
- `phase0-evidence`：完整 v2 batch 的 ID/hash 全匹配时通过；同名 report 的一个 hash 不同时 `matched_reports=5`、`matched_report_hashes=4`、issue 为 `report_hash_mismatch`。
- `phase0-evidence`：v1 evidence 返回 `report_integrity_unavailable`；v2 成功 report 缺 hash 返回 `invalid_phase0_results`。
- `phase0-review`：先生成完整 evidence，再给同一 report 增加不影响 messages/labels 的私有顶层字段；旧实现会错误 `locked`，新实现为 `review_required`，且输出不包含私有字段。
- 更新所有合法 fixtures 为 results v2，并用真实 report bytes 生成期望 hash。
- 完成后运行聚焦测试、全量测试、build、packed/fresh-install、22-file pack 和工作区卫生检查。

## 成功标准

- review 不再能用同名但字节不同的 report 锁定 Phase 0 trust。
- run 记录的 digest 精确对应其完成 contract validation 的字节。
- review 比较的 digest 精确对应其用于消息指标的字节。
- 旧 v1 evidence 明确要求重跑，合法 v2 batch 的既有执行/人工指标不变。
- 输出继续满足隐私收敛和 Phase 0 未锁定声明。
