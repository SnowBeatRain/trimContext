# Phase 0 Report 输入身份绑定设计

## 背景与根因

`phase0:run` 会为每个样本分别执行 `analyze --json`、`report` 和 `compress`。当前 analyze stdout 与 report artifact 已具备最小 `trimctx.report.v2` 契约校验，成功 report 还会记录精确字节 SHA-256，但校验只要求 `input.file` 是字符串，没有确认它属于当前样本。

因此，另一份输入生成的合法 Report v2 可以被当前样本接受。它会错误抬高 analyze/report 成功计数，并可能为错误 report 记录 hash。现有 artifact hash 绑定只能证明 review 使用了 run 验证过的同一份 report 字节，不能证明这份 report 最初来自当前 batch 样本。

## 目标

- analyze JSON 和 report artifact 只有在 `input.file` 精确匹配当前 `Phase0SamplePlan.inputFile` 时才成功。
- 输入身份不匹配时保留子进程退出码，但将对应命令降为失败。
- report 身份失败时不返回解析 metadata，也不记录 `report_sha256`。
- 保持 report 优先、analyze 回退的 metadata 选择规则。
- 错误只使用固定文案和既有 artifact 路径，不回显 report 中声明的错误输入路径。
- 不改变 results v2 schema、scorer、threshold、protected、candidate decision、compression 或六命令公开面。

## 方案比较

### 只比较 basename

不同目录可以包含同名 transcript。basename 相等不能建立样本身份，仍会接受错误 report，因此不采用。

### 使用 realpath 比较文件系统身份

`realpath` 会增加额外 I/O，并把路径别名、符号链接和验证期间文件轮转语义引入 report 契约。Report v2 记录的是调用 pipeline 时传入的路径，而不是文件系统 inode 身份，因此不采用。

### 精确比较 Report v2 `input.file`

采用此方案。Phase 0 runner 已从解析后的输入目录生成绝对 `inputFile`，CLI pipeline 和 reporter 会原样透传该参数到 `report.input.file`。在最小结构校验成功后执行严格字符串相等，可以用最小改动绑定当前既有契约，并能区分不同目录中的同名输入。

## 校验行为

`validateAnalyzeResult(result, inputFile)` 的顺序保持为：

1. 保留失败进程结果。
2. 校验 stdout 存在、可解析为对象且满足最小 Report v2 契约。
3. 校验 `parsed.input.file === inputFile`。
4. 不匹配时返回 `Analyze report input does not match the sample`，不返回 `parsed`。

`validateReportArtifact(result, reportFile, inputFile)` 的顺序保持为：

1. 保留失败进程结果，不检查陈旧 artifact。
2. 校验 artifact 存在、是普通文件、可读、JSON 可解析且满足最小 Report v2 契约。
3. 校验 `parsed.input.file === inputFile`。
4. 不匹配时返回 `Report artifact input does not match the sample: ${reportFile}`，不返回 `parsed` 或 SHA-256。
5. 只有结构和输入身份都成功时，才从同一 Buffer 计算 `report_sha256`。

metadata 继续使用 `reportValidation.parsed ?? analyzeValidation.parsed`。因此 analyze 身份失败但 report 正确时使用 report metadata；report 身份失败但 analyze 正确时使用 analyze metadata。回退只影响聚合 metadata，不会把失败命令恢复为成功。

## 非目标

- 不比较 analyze 与 report 的完整 summary、warnings、messages 或 candidate 数组。
- 不新增 source 与输入扩展名或 parser 结果的交叉校验。
- 不改变 compressed artifact 的现有存在性、普通文件和可读性门。
- 不做大小写宽松、路径规范化、basename 或 inode 等价比较。
- 不把 Phase 0 脚本加入 npm 发布包。

## 测试策略

- analyze 返回属于另一绝对输入路径的合法最小 Report v2，report 正确：analyze 失败、report 成功、metadata 来自 report，序列化结果不包含错误输入路径。
- report artifact 属于另一绝对输入路径，analyze 正确：report 失败且无 `report_sha256`、analyze 成功、metadata 来自 analyze，序列化结果不包含错误输入路径。
- 运行 Phase 0 聚焦测试、全量测试、构建、packed/fresh-install smoke 与 22-file pack 清单验证。

## 成功标准

- 当前样本不能再接受另一输入的 analyze JSON 或 report artifact。
- 身份失败不会产生 report digest 或泄露错误输入路径。
- 正常 batch 的 results v2、metadata fallback 和 report hash 行为保持不变。
- Phase 0 仍未锁定，不扩大对外安全承诺。
