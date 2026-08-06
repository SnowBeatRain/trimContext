# trimctx 当前状态与下一步

## 文档分工

- `README.md`：开源入口和快速开始。
- `docs/dev/requirements.md`：项目需求、边界和验收标准。
- `docs/user/usage.md`：用户使用说明。
- `docs/dev/roadmap.md`：阶段路线和开源门槛。
- `docs/dev/execution-plan.md`：执行任务、数据集和 Phase 0 验收。
- `docs/dev/iteration-plan.md`：团队评审后的当前迭代计划、优先级和质量门。

## 分支整理状态（2026-07-18）

- `refactor/full-command-optimization` 保留在远端作为历史参考，不删除、不继续作为发布分支开发。
- 该分支已被 `main` 上的选择性整合方案取代：报告摘要、Codex tool item 归一化、ROT 指标计算三个低耦合抽取已进入主线；Hook dry-run 防泄漏修复已按当前 `0.2.10` 架构重写并进入主线。
- 相对整合前发布基线 `origin/main@80aeae5`，该分支的独有提交计数为 `2 / 12`，精确合并重演在 `src/cli.ts`、`src/commands/new-chat.ts`、`src/core/compressor.ts`、`src/platform/files.ts` 产生 4 个核心语义冲突。相对已完成选择性整合的当前 `main@0598895`，计数为 `7 / 12`，并因两边都调整 Hook 回归覆盖而新增 `tests/hook.test.ts` 冲突。
- 这些冲突涉及命令架构、当前会话、压缩安全、文件写边界和 Hook 回归契约，且旧分支仍基于 `0.2.9`，因此不采用完整合并或简单的 `ours` / `theirs` 消解。
- 后续发布以 `main` 为唯一候选；除非明确开展历史代码研究，否则不要从该分支继续提交或发布。

## 当前已经完成

### v0.1 核心 CLI

- `trimctx analyze <file>` / `--json`
- `trimctx report <file> -o report.md|report.json`
- `trimctx compress <file> -o <output.jsonl>`
- Claude Code / OpenAI / Codex-Hermes 三种 JSONL parser（自动检测格式）
- 近似 tokenizer（零外部依赖）
- 安全规则引擎（13 条 hard-protect 规则）
- 多维度 rot 评分器（6 维评分 + 重要性折扣）
- `trimctx.report.v2` schema（含 assessment、findings、review_queue 和 recommendations）
- 安全压缩器（原文件 hash 不变）

### v0.2 CLI 可用性与集成

- `trimctx init` — 从 npm 包安装 Claude Code 插件和 Codex skill
- `trimctx` / 不带文件的 `analyze` — 只分析 hooks 绑定的当前窗口；本地发现使用 `analyze --select/--latest`
- `trimctx new-chat` — 生成确定性 UID 交接包，默认输出 `.trimctx/handoffs/<uid>/`
- `trimctx export [file] -o conversation.md` — 导出 parser 识别的全部规范化消息，不评分、不脱敏且保持原 JSONL 只读
- Claude Code 插件（`plugins/trimctx/`）：`/trimctx`、`/trimctx:analyze`、`/trimctx:export`、`/trimctx:new-chat`、`/trimctx:compress`
- Codex skill（`codex/skills/trimctx/SKILL.md`）
- GitHub 安装脚本（`install.sh` / `install.ps1`）
- Markdown 会话健康报告，以及与 `analyze --json` 一致的 v2 JSON 报告

### Report v2 人类可读层与信号质量优化（2026-08-05）

- `analyze` 短摘要和中文 Markdown 报告统一使用中文状态、置信度、发现、续接缺失和建议文案。
- assessment limitation 只在人类报告的专用限制区域展示一次，不再作为普通 finding 重复输出。
- 已成立的负向风险优先于 observability limitation；limitation 仍保留，存在 limitation 的 degraded 结论使用 medium confidence。
- `findings` 按 signal code 聚合并按实际 decision 风险确定 severity；`candidate_groups` 和 JSON `review_queue` 保持完整。
- Markdown 每条 finding 最多展示 5 条 evidence，并将 protected 与非 protected 审查项分区展示，避免重复长表。
- `trimctx.report.v2` 字段结构和英文机器文案保持稳定；assessment/finding 值按上述语义有意改进，scorer、threshold、safety、decision 和 compression 行为不变。
- Claude Code、OpenAI、Codex sanitized fixtures 已复核；Windows packed-install 和六命令 smoke 继续由完整测试覆盖。
- 两份近期 Codex 会话复验分别保留 9/96 个 candidate groups，同时收敛为 3/4 个 signal findings；575-message 样本由 `unknown/low` 修正为 `degraded/medium`，1,468-message 样本的 Markdown 由 506,461 bytes 降至 170,578 bytes。

### Report v2 observability warning 边界（2026-08-06）

- 顶层 `warnings` 继续完整保留 compact、近似 token 和 `compress_candidate` 仅供报告审查三类既有文案与顺序；内部诊断现在显式标记 warning 是否影响 observability，不再靠文案过滤。
- session compact 表示原始对话细节已不可完整观察，近似 token 会降低 token 加权度量的可靠性，两者继续计入 observability；`compress_candidate` report-only 说明只描述产品行为，不再虚增观测证据或单独阻止 `healthy`。
- 两份 Claude 与两份 Codex 真实报告已用 UTF-8 结构化读取重跑；全部输入 SHA-256、顶层 warnings、消息决策及非 observability 报告投影不变。两份 Claude 的 observability evidence count 仅由 3 降为 2，Codex compact/无 warning 样本和四份总体状态均不变。
- 本轮不改变 parser、tokenizer 选择、scorer、threshold、safety、decision、candidate groups、review queue 或 compression；`phase0_trust` 仍需多来源人工标签和真实私有 OpenAI export 才能锁定。

### Stop hook CLAUDE.md 并发写边界（2026-08-06）

- 确定性真实文件探针复现了 `read A -> 外部写 B -> hook 基于 A 写 C`：旧原子替换保证文件完整，却会静默覆盖读取后产生的 B；原文件不存在、提交前被其他主体创建时也有同类问题。
- `readClaudeMd()` 现在一次返回 UTF-8 内容与同一读取的精确原始字节；`writeClaudeMd()` 必须传回该快照。目标字节变化、已有目标被删除或缺失目标被并发创建时，Stop 以固定错误 fail closed，保留当前目标且不自动重试。
- 共享条件原子写在 staging 前、提交前及 Windows replacement fallback 移动 backup 前复核目标；精确字节相同允许提交，空文件与不存在明确区分。Windows 注入回归已实际证明首次 rename 失败后出现的并发内容不会被后续 fallback 覆盖。
- 该机制不引入锁文件、watcher 或自动 merge。Node 跨平台文件 API 无法把任意字节比较和 rename 合成一个不可分割操作，因此最后一次复核到系统 rename 之间仍有极窄竞态窗口，不能宣称线性化 CAS。
- 5 个聚焦测试文件共 76 项通过；全量为 50 文件、514 项，strict TypeScript 与 build 退出 0，独立 packed/fresh-install 5/5，`npm pack --dry-run` 为既有 22-file 包面。修复后 A/B/A 探针确认冲突被拒绝、B 完整保留、stale A 未提交、临时工件为 0；正常受管区块替换/清理、SessionStart、原 transcript SHA-256、scorer、threshold、report、compression 和六命令契约均未改变。

### Candidate reasons 完整性边界（2026-08-06）

- `src/core/report-review.ts` 现在要求每条 `remove_candidate` 和 `compress_candidate` 至少有一个 reason；删除候选原有的非 protected 与 high-confidence decisive evidence 校验保持不变。
- `phase0:review` 独立验证持久化报告中的候选 reasons。缺失、空数组或非数组统一计入固定聚合指标 `missing_candidate_reasons` 和 `report_quality_issues`，并保持 `review_required`；JSON/Markdown 不输出 reason 原值、message ID、路径或正文。
- 四份现有 Report v2 真实审计报告共包含 419 条 `remove_candidate` 和 29 条 `compress_candidate`，缺失 candidate reasons 为 0；本轮不修改这些报告或原 transcript。
- 这是报告生成与归档证据的可解释性收紧，不改变 scorer、threshold、protected、decision 或 compression。`compress_candidate` 继续仅供报告审查，Phase 0 仍未锁定，不能据此宣称无需人工复核的压缩安全。

### Phase 0 report artifact 身份绑定（2026-08-06）

- `phase0:run` 现在输出 `trimctx.phase0.results.v2`，每个成功 report 都记录从已解析、已通过最小契约校验的原始 Buffer 计算出的 `report_sha256`；失败 report 不伪造 digest。
- `phase0:review` 从实际用于消息指标的同一 Buffer 重算 digest，并同时要求 report ID 集合和 SHA-256 全部匹配。同名 report 在 batch 后发生任何字节变化都会产生固定 `report_hash_mismatch` 并保持 `review_required`。
- 旧 results v1 缺少内容身份，明确产生 `report_integrity_unavailable` 并要求重跑；review JSON/Markdown 只公开 `matched_report_hashes` 聚合数和固定 issue，不公开 digest、路径或正文。
- 六份 Claude/OpenAI/Codex sanitized fixtures 已通过真实 `phase0:run` 链路：results v2 中 6/6 report digest 与磁盘精确字节一致，6/6 输入前后 hash 一致，失败样本为 0；本轮临时验证目录已清理。
- 该机制检测 batch evidence 与 review artifact 的偶然漂移，不是数字签名，也不抵抗能同时重写两者的主体；scorer、threshold、protected、candidate decision、compression、六命令和原 transcript 只读契约均未改变，Phase 0 仍未锁定。

### Phase 0 report 输入身份绑定（2026-08-06）

- `phase0:run` 现在要求 analyze JSON 和 report artifact 的合法 Report v2 `input.file` 与当前 batch 传入的绝对 `inputFile` 精确相等；另一会话生成的结构合法报告不再能抬高当前样本成功计数。
- analyze 身份失败仍允许合法 report 提供聚合 metadata；report 身份失败仍允许合法 analyze fallback，但失败状态不会被 fallback 改回成功，且错误 report 不记录 `report_sha256`。
- 身份错误只输出固定文案和既有 report artifact 路径，不回显报告声明的错误输入路径。比较沿用 CLI 原样透传路径的既有契约，不引入 basename、大小写宽松、`realpath` 或 inode 等价语义。
- 该门补齐“当前样本 -> 已验证 report bytes -> review bytes”的身份链；下述完整语义门继续绑定 analyze/report 内容。scorer、threshold、protected、candidate decision、compression、六命令和原 transcript 只读契约均未改变，Phase 0 仍未锁定。

### Phase 0 analyze/report 完整语义绑定（2026-08-06）

- 六份 Claude/OpenAI/Codex sanitized fixtures 的真实 CLI 探针确认：`analyze --json` 与 JSON `report` 解析后的完整 Report v2 均逐值相等，输入 SHA-256 全部不变；两者原始字节因 compact/pretty 格式不同，不适合作为语义比较。
- 新增 script-scoped canonical JSON 指纹：递归排序对象键，保留数组顺序、JSON primitive 和全部 Report v2 字段，不设置波动字段白名单；循环、非有限数字或其他非 JSON 运行时值 fail closed。
- `phase0:run` 新增独立 `analyze_report.status`、私有 `analyze_semantic_sha256` 和 `aggregate.analyze_report_matched`。mismatch 不错误归因给任一命令，但会通过 `isPhase0SampleOk()` 进入 `failed_samples`，避免被 95% 命令成功率稀释。
- `phase0:review` 从当前 report 的同一解析对象独立复算，新增 `expected_analyze_report_pairs`、`matched_analyze_report_semantics`、`analyze_report_semantic_mismatch` 和 `analyze_report_semantic_validation_unavailable`。旧 results v2 可读取但必须重跑；非法现有状态/digest/aggregate 仍归为 `invalid_phase0_results`。
- 六份 sanitized fixtures 已通过真实 batch/review：analyze、analyze/report 语义、report、compress、输入不变、report hash 和 compressed hash 均为 6/6，validation issue 为 0；人工标签故意为空，因此最终状态仍为 `review_required`。
- 将 results 中一份 analyze canonical digest 改为另一合法值后，report ID/hash/source/input 与 compressed artifact/hash/structure/message set 继续为 6/6，语义匹配独立降为 5/6，唯一 validation issue 为 `analyze_report_semantic_mismatch`。
- review JSON/Markdown 不输出 canonical JSON、digest、字段差异、路径、ID 或正文。该门只证明两条命令共享完整语义，不证明共同输出正确，不改变 Report v2、评分、阈值、protected/candidate decision、compression、六命令或 transcript 只读边界，Phase 0 仍未锁定。

### Phase 0 report 来源绑定（2026-08-06）

- `phase0:review` 现在从实际解析的 report 对象读取 `input.source`，与 results v2 中同一成功 report ID 的 source 声明精确对账；此前 results 可声明完整 2 Claude/1 OpenAI/2 Codex 覆盖，即使五份 hash 匹配报告实际全来自 Claude并错误得到 `locked`。
- review v2 新增隐私安全聚合数 `matched_report_sources`。source 不一致产生固定 `report_source_mismatch`，JSON/Markdown 不输出 report ID、路径或非法 source 原值。
- 来源覆盖现在只统计 results 中预期成功 report ID 对应的实际支持来源；analyze-only metadata、失败或缺失 report、额外 stale report 和非法 source 均不能满足覆盖门。合法 results v2 无需迁移。
- 该门与既有 ID/hash/input identity 共同约束 Phase 0 证据，不改变 scorer、threshold、protected、candidate decision、compression、六命令和原 transcript 只读契约，Phase 0 仍未锁定。

### Phase 0 输入证据绑定（2026-08-06）

- `phase0:review` 现在要求 results v2 每个样本包含非空 sample 和合法 lowercase before/after SHA-256，且 `input_unchanged` 必须与两个 digest 是否相等严格一致；局部翻转布尔值或损坏 hash 会得到固定 `invalid_phase0_results`。
- 合法记录的真实输入变化仍得到 `input_mutation_detected` 和 `failed`，不会被误归为 evidence 损坏。review 不重新读取可能已继续增长或移动的原 transcript。
- 实际 report 的 `input.file` 现在与同一成功 result 的 `sample` 精确对账；错绑产生固定 `report_input_mismatch`，review v2 只新增 `matched_report_inputs` 聚合数，不公开路径或 digest。
- 六份 sanitized fixtures 已按真实 batch 路径复核；本门不改变 scorer、threshold、protected、candidate decision、compression、六命令或 transcript 只读契约，也不是数字签名，Phase 0 仍未锁定。

### Phase 0 命令输入 SHA-256 绑定（2026-08-06）

- 受控 A/B/A 探针确认了跨进程 TOCTOU：旧 runner 只比较批次首尾路径哈希，输入在首次哈希后临时替换、三条命令处理另一份内容、末次哈希前恢复时，analyze/report 语义、report/compress 对应和 `input_unchanged` 可同时通过。
- runner 现在把首次摘要通过内部 `TRIMCTX_PHASE0_EXPECT_INPUT_SHA256` 环境传给 `analyze`、`report` 和 `compress`；三条路径都校验各自实际解析的同一 Buffer，摘要不匹配会在 analyze 输出或 report/compressed 新目标写入前 fail closed。普通 CLI 没有内部期望值时保持原行为。
- results v2 每个新 sample 增加 `input_sha256_bound:true`，aggregate 和 review v2 增加同名计数。旧 v2 缺 sample/aggregate 证据会得到 `input_sha256_binding_unavailable` 并保持 `review_required`；非法 present 值归为 `invalid_phase0_results`，合法计数漂移沿用 `aggregate_mismatch`。
- 该机制不创建持久原文快照，不改变 Report v2、scorer、threshold、protected/candidate decision、compression、六命令或 transcript 只读契约。它依赖 SHA-256 抗碰撞性，不是数字签名，也不对能够同时改写源码和全部证据的主体提供保证。

### Phase 0 压缩产物集合复核（2026-08-06）

- `phase0:review` 现在按 results 顺序精确重算 `aggregate.failed_samples`，并拒绝重复 sample、重复成功压缩产物 ID 或其他聚合矛盾，避免局部编辑 evidence 后仍错误满足 readiness。
- review 独立枚举 reports 目录中的 `.trimmed.jsonl`；只有普通文件且可通过只读句柄成功打开和关闭的目标才进入实际集合。该集合必须与成功 compress 声明的唯一 ID 集合完全一致，缺失、额外陈旧、目录/symlink 占位或不可读目标统一产生 `compressed_set_mismatch`。
- review v2 只新增 `expected_compressed_artifacts` 与 `matched_compressed_artifacts` 聚合数，并使用固定 `duplicate_samples`、`duplicate_compressed_ids`、`compressed_set_mismatch` issue；不输出路径、ID、操作系统错误或正文。
- 六份 Claude/OpenAI/Codex sanitized fixtures 已通过真实 batch/review 链路：完整集合为 6/6 且 validation ready/passed；临时隐藏其中一份产物后变为 5/6、仅产生 `compressed_set_mismatch`，review JSON/Markdown 未回显抽查的样本 ID 或临时路径。
- 集合门现由下述内容身份门补强；这两个既有门本身仍只验证 artifact presence/bytes，随后再由结构与 decision 对账门验证 adapter 可重读性和规范化消息集合。三者都不改变 scorer、threshold、protected、candidate decision、compression、六命令或原 transcript 只读契约。

### Phase 0 压缩产物内容身份绑定（2026-08-06）

- `phase0:run` 现在从成功校验时读取的精确 Buffer 计算 `compress.output_sha256`；失败 compress 或缺失、非普通、不可读产物不记录 digest，既有成功/失败计数语义保持不变。
- `phase0:review` 将实际可读普通 `.trimmed.jsonl` 收集为 ID/SHA-256 map，在既有集合相等之外要求 digest 相等。旧 v2 成功项缺 digest 产生 `compressed_integrity_unavailable`，同名内容变化产生 `compressed_hash_mismatch`，非法现有 digest 仍归为 `invalid_phase0_results`。
- review v2 新增 `matched_compressed_hashes` 聚合数；JSON/Markdown 不输出路径、ID、digest、正文或操作系统错误。SHA-256 只检测 evidence 与产物漂移，不是数字签名，能同时改写两者的主体仍可重算。
- 六份 Claude/OpenAI/Codex sanitized fixtures 经真实 batch/review 链路得到 6/6 digest、6/6 artifact 与 6/6 hash 匹配，validation ready/passed 且 issue 为 0；用另一公开 fixture 原子替换一个同名产物后，artifact 仍为 6/6、hash 降为 5/6，唯一 validation issue 为 `compressed_hash_mismatch`，review 未回显目标路径或 digest。本轮临时验证目录已清理。
- 内容身份门本身只绑定字节；下述结构与 decision 对账门在同一已绑定 Buffer 上补充 JSONL 重读和规范化消息集合验证。两门都不核对原 transcript，也不证明 scorer 决策安全；results/review schema 版本、scorer、threshold、protected、candidate decision、compression、六命令和原 transcript 只读契约均未改变，Phase 0 仍未锁定。

### Phase 0 压缩结构与 decision 对账（2026-08-06）

- 新增 script-scoped 共享校验器：按 report `input.source` 选择 Claude/OpenAI/Codex adapter 重读完整 `.trimmed.jsonl`，以 `source + role + content + timestamp + sessionId` 构造不出现在输出中的 SHA-256 identity，并用多重集计数处理重复消息。Codex 行号与 OpenAI batch index 不参与 identity，parser 明确忽略的合法 runtime/metadata 记录继续允许。
- `phase0:run` 在 report artifact 有效时对成功 compress 的同一 Buffer 先做结构与集合校验；malformed JSONL、合法 JSON 但保留集合漂移、或 report message 无法形成 identity 会保留子进程退出码但把 `compress.ok` 降为 false，且不记录 `output_sha256`。report 自身无效时保留 compress 独立文件/hash 结果，样本仍由 report failure 失败，review 也无法满足语义 readiness。
- `phase0:review` 独立复算当前 report/artifact 对，新增 `structurally_valid_compressed_artifacts`、`matched_compressed_message_sets` 和固定 `compressed_structure_invalid`、`compressed_message_set_mismatch`、`compressed_validation_unavailable`；JSON/Markdown 不输出正文、fingerprint、路径、ID、digest、parser 文案或 mismatch 值。
- 三种公开 fixture 的真实 `compressFile` 输出均通过共享校验；单元与进程回归覆盖 OpenAI index 漂移、Codex ignored metadata、重复计数、空输出、malformed JSONL、消息增删改和 remove candidate 残留。该门只证明 adapter 可重读与记录的 decision 集合相符，不验证 decision 是否正确，不替代人工标签，也不宣称 Phase 0 已锁定。
- 六份 Claude/OpenAI/Codex sanitized fixtures 已通过真实 batch/review 链路：analyze、report、compress、输入不变、产物集合、产物 hash、结构可重读和保留消息集均为 6/6，validation issue 为 0。人工标签故意留空，因此最终状态仍为 `review_required`。
- 在同步当前私有 digest 后分别注入两类受控漂移：malformed JSONL 使结构与消息集均降为 5/6，唯一 issue 为 `compressed_structure_invalid`；合法 JSON 消息漂移保持结构 6/6、消息集降为 5/6，唯一 issue 为 `compressed_message_set_mismatch`。临时验证工件不作为产品输出保留。

### Session discovery 边界拆分（2026-08-06）

- `src/sessions/catalog.ts` 独立负责 Claude/Codex 根目录、递归 JSONL 元数据扫描、排序、latest 选择和 source 解析。
- `src/sessions/binding.ts` 独立负责可信当前窗口绑定校验，以及 `new-chat` 既有的 binding-first/latest fallback 兼容语义。
- `src/sessions/discovery.ts` 保留为兼容 facade；命令和 picker 已改用 catalog/binding 的最窄依赖，`src/core/session.ts` 下游导出保持不变。
- catalog 可注入 home，binding 可注入 environment，边界测试不再必须依赖全局 HOME 或 `process.env` 才能验证核心路径。
- catalog 只把根目录、子目录或轮转中 JSONL 的 `ENOENT` 解释为缺失；`readdir/stat` 的权限、I/O 和其他错误会穿透 latest 与 `new-chat` fallback，不再被伪装成空目录或普通 no-session 帮助。
- 六命令、扫描目录、候选排序、session ID 规则、错误文案、`new-chat` fallback、hook 写入范围和原 transcript 只读契约均未改变。

### Report construction 边界拆分（2026-08-06）

- `src/core/report-evidence.ts` 独立负责 evidence 公共形状转换和 confidence 排序。
- `src/core/report-findings.ts` 独立负责完整 candidate groups、按 signal code 聚合的 findings、关系去重、decision 风险 severity 和稳定排序。
- `src/core/report-review.ts` 独立负责 review queue、`remove_candidate` 报告不变量校验、摘要脱敏、风险排序和 recommendations。
- `src/core/reporter.ts` 从 430 行收敛到 131 行，只保留 `createReport()` 编排、归一化、parser diagnostics、Phase 0 trust 和 warning 投影；warning 创建与 observability 分类集中到 diagnostics 边界，pipeline 与 compressor 的 facade 入口不变。
- 新增直接边界测试，并用 facade 深度一致性断言覆盖 groups、findings、review queue 和 recommendations。
- 575 / 1,468-message 两份 Codex 样本重新生成后，JSON 和 Markdown 均与拆分前基线逐字节 SHA-256 相同；9/96 个 groups、3/4 个 signal findings、assessment 状态和 52,349/170,578-byte Markdown 均未改变。
- Report v2 schema、文案、排序、scorer、threshold、safety、decision、compression、六命令和原 transcript 只读契约均未改变。

### Report v2 续接建议证据对齐（2026-08-06）

- `clarify_continuation` 不再固定要求澄清当前目标和下一步；JSON summary 现在只枚举 `resume.readiness.missing` 中实际存在的类别，CLI 与 Markdown 通过同一缺口列表生成中文文案。
- 两份 Claude 与两份 Codex 私有报告的只读结构审计发现：一个 partial 样本已有可信 current goal，实际仅缺 active files 与 next steps，旧固定文案仍错误要求澄清 current goal。该证据只以聚合结论记录，未复制报告路径、ID 或正文。
- 本轮不新增 Report v2 字段，不改变 recommendation code、priority、排序或 command，也不改变 readiness 提取、权重、阈值、scorer、protected、decision、compression、六命令和原 transcript 只读契约。

### Init 命令边界拆分（2026-08-06）

- `src/commands/init-plan.ts` 独立负责 client/target 解析和 Claude/Codex 资产路径规划，package root 改为显式参数。
- `src/commands/init-prompt.ts` 独立负责 buffered readline、交互判定、target 别名与重试文案，并允许测试注入 prompt/output/TTY 事实。
- `src/commands/init-installer.ts` 独立负责模板可读性、destination 冲突和 trimctx-only force 安全规则；`src/commands/init-transaction.ts` 负责目录 staging、commit、rollback 和清理。
- 真实安装在任何复制/删除前预检全部模板、冲突和 force destination；`--client all` 的第二个资产发生可预测错误时，不再留下第一个资产的半安装状态。
- 全部客户端资产先复制到目标同级 stage，再以 backup + rename 提交；copy 或 commit 失败会逆序恢复已提交目标，新安装目标回滚为不存在，强制替换目标恢复旧目录。
- rollback 或 stage cleanup 失败会连同原始操作错误一起报告，并保留未恢复 backup 或未删除 stage 供人工处理；进程强制终止、断电和操作系统崩溃仍不提供持久化 journal 或下次启动自动恢复。
- 目标存在性检查只把 `ENOENT` 解释为新安装；权限或其他 I/O 错误会在首个 staging copy 前原样失败，不再被误判为目标缺失后进入写路径。
- `src/commands/init.ts` 从 263 个物理行收敛到 101 行，只保留 Commander 注册、base directory、hooks、summary 和 next-step 编排；模块级可变 `packageRoot` 已移除。
- `--with-hooks` 组合流程会先通过现有 dry-run 边界读取并验证 Claude settings，再开始任何 Claude/Codex 资产写入；无效或不可读 settings 不再让失败命令留下已创建/已替换资产。真实 hook 写入仍在资产安装后重新读取 settings 并原子替换，不扩大持久化范围。
- 新增 16 项直接 init 边界测试，并把 invalid settings 进程回归扩展到 Claude 单客户端和 `all` 双客户端无资产副作用；init/hook/six-command 86 项聚焦测试与 package/fresh-install 5 项测试均保持通过。
- 安装路径、prompt、成功输出、dry-run、force、hooks、22-file 包资产清单、六命令和原 transcript 只读契约均未改变。

### 共享文件存在性错误分类（2026-08-06）

- init 目标与 `new-chat` UID package 目录的存在性检查现在只把 `ENOENT` 解释为不存在；权限、I/O 和其他文件系统错误会在对应写入前原样失败。
- `sameFile()` 仍允许两个确实不存在的不同路径，并由输出打开句柄后的 inode 检查继续承担最终冲突保护；任一 `stat` 的权限、I/O 或其他非 `ENOENT` 错误会原样失败，不再被误判为“不同文件”。
- Windows 原子替换在首个 rename 失败后只把目标 `ENOENT` 解释为不存在；若目标类型检查本身也失败，会按顺序保留 rename 与检查两条原因，同时保留旧目标并清理本进程拥有的 temp。
- 正常新安装、新聊天包生成、六命令和原 transcript 只读契约均未改变。

### New-chat UID package 所有权与失败清理（2026-08-06）

- `new-chat` 在创建 UID 目录前完成 input 读取、分析和五个输出正文构造，再通过 root recursive mkdir 与 package non-recursive mkdir 原子取得目录所有权。
- `EEXIST` 目录从未归本进程所有，因此只返回既有冲突文案，不读取、修改或清理其中内容；写入失败只递归删除本次 owned UID package，不影响 root 或 sibling package。
- 写入与 cleanup 同时失败时用 `AggregateError` 保留两类错误和残留目录；五文件 writer 成功返回后 package 视为完整，硬终止、断电和操作系统崩溃仍不提供 journal 或下次启动清理。
- UID 格式、五文件内容、manifest 路径、成功 stdout、六命令和原 transcript 只读契约均未改变。

### 共享多输出 writer 的 close 错误保留（2026-08-06）

- `writeFilesDistinctFromInput()` 现在显式记录 open/stat/truncate/write 主操作结果，并用 `Promise.allSettled()` 关闭所有已打开的输出句柄，不再让首个 close 失败覆盖原始操作错误或隐藏其他 close 失败。
- 多原因按 operation 叶子优先、随后按句柄打开顺序聚合；仅一个 operation 或 close 错误时仍抛原对象，保持既有单错误身份。
- open flags、inode 冲突检查、truncate/write 顺序、compress 输出、`new-chat` owned package 清理、六命令和原 transcript 只读契约均未改变。

### Compress 读前快照与原子输出（2026-08-06）

- `compressFile()` 现在在读取 input handle 前记录 stat snapshot，压缩正文仍完全在内存中按既有 parser/scorer/safety/decision 生成，再通过 input-bound 同目录原子写提交。
- 提交前会复核同一 open input 的 inode、size、mtime 和 ctime，并再次检查 output alias；分析期间输入变化会失败，不再提交基于旧字节生成的副本。
- stage 写入、identity 检查或 commit 的可恢复失败会保留既有 compressed copy；成功 JSONL 字节、候选数量、protected/remove 规则、stdout、六命令和原 transcript 只读契约均未改变。

### 原子写临时路径所有权与 cleanup 错误（2026-08-06）

- 普通原子写与 input-bound 原子写现在只在 exclusive open 成功后拥有随机 temp path，并在 direct rename 或 Windows replacement 把 temp 移到 output 时立即结束该所有权；open 失败或 commit 成功后不再删除旧随机名。
- 主操作、temp handle close 与 temp rm 同时失败时，所有错误按发生顺序平铺进 `AggregateError`；close 失败不再短路 rm，cleanup 成功时仍保持原主错误身份。
- 无法删除的 `.trimctx-*.tmp` 保留供人工定位，产品错误不读取或回显其中可能包含的 settings、CLAUDE.md、report 或 export 正文；硬终止、断电和系统崩溃仍不保证清理。
- output backup/restore、input identity/snapshot、成功输出、六命令和原 transcript 只读契约均未改变。

### CLI 聚合错误呈现（2026-08-06）

- 公共 CLI 与 Phase 0 review 现在共用纯错误格式化边界；普通错误继续保持既有单行 message，`AggregateError` 则按原顺序递归展开全部叶子原因。
- init、new-chat、原子写与 Phase 0 双工件事务保留的 operation、restore、close、stage/backup/temp cleanup 错误现在能从真实入口看到，不再只显示顶层事务摘要。
- 格式化只读取顶层与叶子 error message，不读取 stack 或错误对象附加的 settings、report、export 等工件数据；命令参数、成功 stdout、六命令和原 transcript 只读契约均未改变。

### Claude hooks 安装安全与边界拆分（2026-08-06）

- 已直接复现并修复两条数据保留问题：无效 `settings.json` 不再被当作缺失文件覆盖；`--force` 不再删除与 trimctx hook 位于同一 group 的用户 hook。
- `src/commands/hook-settings.ts` 独立负责结构验证、精确 command 匹配、未知字段保留和 SessionStart/Stop 纯规划。
- `src/commands/hook-installer.ts` 独立负责 ENOENT/read/JSON 错误区分、dry-run 隐私文案、序列化和原子持久化；错误信息不包含 settings 内容。
- `src/commands/hook.ts` 从 101 个物理行收敛到 18 行，只保留隐藏的 SessionStart/Stop runtime command facade；`init.ts` 改用 installer 的最窄依赖。
- `src/platform/files.ts` 新增普通文件 `atomicWriteFile()`，与 transcript 输出共享同目录 temp、Windows replacement/restore 和清理机制，同时保留 transcript 专用的双重 input snapshot/identity 检查。
- 新增 11 项纯 settings、4 项 installer 和 2 项普通 atomic-write 覆盖；hook/init 聚焦回归共 75 项通过。
- hook 命令、`--with-hooks/--force/--dry-run` 成功文案、dry-run 隐私、SessionStart 环境绑定、Stop 受管 CLAUDE.md 区块、六命令和 transcript 只读契约均未改变。

### Claude Stop runtime 存储安全（2026-08-06）

- 已用真实文件系统复现：当 `.claude/CLAUDE.md` 实际是目录时，旧 `readExistingClaudeMd()` 会吞掉非 ENOENT 错误，并让 `hook --dry-run` 以成功状态继续。
- 新增 `src/core/hook-storage.ts`，只负责 CLAUDE.md 的 ENOENT-only 读取语义和 `mkdir + atomicWriteFile()` 持久化；其他读取错误保留 cause 并带目标路径 fail closed。
- `src/core/hook.ts` 已移除宽泛读取 catch 和两处直接 `writeFile()`，继续只负责 stdin、分析和受管区块编排；该轮 SessionStart 的追加逻辑未改，后续已由“SessionStart transcript 别名安全”边界补上输入/输出身份校验。
- 新增 4 项真实文件系统存储测试和 3 项 Stop 进程级回归，覆盖不可读目标、低压清理、候选状态替换、非受管内容保留、原子临时文件清理，以及每次运行前后 transcript SHA-256 不变。
- 该轮并发 Stop 仍采用最后成功写入者语义；后续“Stop hook CLAUDE.md 并发写边界”已用精确字节快照改为冲突 fail closed，仍未引入锁，也未修改 parser、scorer、threshold、safety、report 或 compression。

### CLAUDE.md 受管 marker 所有权安全（2026-08-06）

- 已直接复现三种旧行为：残缺 start marker 会追加第二个区块；end 在 start 前会重复重叠的用户内容；两个完整区块只替换第一个并遗留第二个。
- `injectContextStateSection()` 现在只接受零个 marker 或唯一且顺序正确的一对 marker；残缺、倒序、重复 start/end 和多个完整区块统一 fail closed。
- 合法替换和移除改为只拼接 marker 精确范围之外的原始前后缀，不再 `trim` 用户空白，也不再在已有后缀前额外插入换行；无 marker 的既有追加格式保持不变。
- 新增 8 项纯 marker/字节保持回归和 1 项 Stop 进程回归；歧义 marker 下 CLAUDE.md 与 transcript SHA-256 均保持不变。
- 本轮不自动修复所有权不明确的区块，不引入 marker migration，也不改变 SessionStart、报告、评分、阈值、安全或压缩行为。

### CLAUDE.md 目标文本持久化安全（2026-08-06）

- 数据流复核确认 `resume/extractor.ts` 已负责单行化、基础脱敏和 220 字符限制；本轮没有修改其 Report v2、handoff 或 new-chat 输出契约。
- 已通过真实 Stop 进程复现可达问题：显式目标中的 `Authorization: Bearer ...` 不在 extractor 现有脱敏范围内，会被原样持久化到项目 CLAUDE.md。
- `formatContextState()` 现在在最终持久化展示边界再次处理目标文本：补充 Authorization/Basic/credential URL 等脱敏，精确中和 trimctx start/end marker，清理控制字符、压平空白，并维持 220 字符上限和空值回退。
- 完整 marker 通过手工构造的 AnalysisReport 验证 formatter 自身不再破坏 marker 不变量；正常 extractor 会在 marker 的 `!` 处分段，本轮没有把该防御性测试误记为真实提取链路。
- 新增 2 项直接 formatter 回归和 1 项两次 Stop 进程回归；两次写入均只保留一对 marker，不泄露凭据、不残留原子临时文件，transcript SHA-256 不变。

### SessionStart 绑定覆盖安全（2026-08-06）

- 已通过连续两次真实 SessionStart 进程稳定复现：第一次写入旧 transcript/ID，第二次只提供新 transcript 时，旧实现会保留旧 `TRIMCTX_SESSION_ID`，使绑定解析得到不一致的“新路径 + 旧 ID”。
- `writeSessionEnvBinding()` 现在每次都向窗口自己的 `CLAUDE_ENV_FILE` 追加完整的两变量快照；缺少可选 `session_id` 时显式写入 `export TRIMCTX_SESSION_ID=''`，不再继承旧身份。
- 绑定仍按 Claude env 文件语义追加，不重写文件、不从文件名猜测 ID、不回退 latest；原始 transcript 始终只读。
- 新增两次 SessionStart 进程级回归，覆盖空 ID 覆盖、无文件参数 `analyze --json` 选择新 transcript，以及两份 transcript 前后 SHA-256 不变。

### SessionStart transcript 别名安全（2026-08-06）

- 真实 CLI 同路径探针已复现：将 `CLAUDE_ENV_FILE` 设为 `transcript_path` 后，旧 SessionStart 退出 0、报告更新成功并把两条 shell export 追加进原 JSONL，直接违反 transcript 始终只读契约。
- 新增 `appendFileDistinctFromInput()`：先拒绝相同 resolved path，再只读预检 transcript（仅 `ENOENT` 视为尚未创建），随后以 `O_APPEND` 打开 env 目标并比较两个实际 handle 的 `dev/ino`；写入只通过已验证的 env handle，不在校验后重新按路径打开输出。
- 同路径与 hardlink 真实进程回归均要求非零退出、固定 `Claude session env file must be different from transcript` 错误和 transcript SHA-256 不变；平台层同时覆盖已有 env 追加、不存在 env 创建、尚未创建 transcript，以及 operation/output-close/input-close 全错误聚合。
- 普通 SessionStart 仍追加完整的路径/ID 两变量快照，缺少 ID 仍显式清空旧绑定，缺失 transcript 仍可先写绑定；除 `ENOENT` 外的 transcript 打开失败改为 fail closed。
- 该边界不改写或解析 Claude env 文件，不引入锁。最后一次 inode 比较到单次 append 之间仍不是线性化事务；Stop、scorer、threshold、report、compression 和六命令均未改变。
- 修复后真实同路径 CLI 探针确认非零退出、transcript 字节不变、未追加 env 绑定、固定冲突错误存在且 stdout 不误报更新；仓库工件扫描未发现 `.tgz`、`output-N.txt`、`.trimctx-*.tmp/.bak`、stage 或 tamper 残留。
- 真实 NUL 路径探针确认旧顺序会在 transcript 打开失败前创建 0-byte `CLAUDE_ENV_FILE`；输入句柄预检前移后，非 `ENOENT` 打开失败不再接触输出。该修复不增加路径 allowlist，不删除失败后的 env 文件，也不改变 transcript 尚未创建时先写绑定的既有行为。

### Hook stdin 运行时结构校验（2026-08-06）

- 已通过真实进程复现：顶层 `null`、数字 `transcript_path` / `session_id` 会分别暴露 JavaScript 空引用、shell quote 或 Node path 的内部错误；失败发生在写入前，但文案不稳定且依赖下游实现。
- 新增 `src/core/hook-input.ts`，统一负责 stdin 读取、隐私安全的 JSON 错误包装、顶层对象校验和已知字段类型校验；未知 Claude hook 字段继续允许并在返回 trimctx 输入时忽略。
- SessionStart 与 Stop 现在都在目录创建、env 追加、transcript 分析和 CLAUDE.md 访问前完成相同校验；malformed JSON 不回显 stdin，非法输入不创建 env 文件或项目 `.claude` 目录。
- 新增 6 项纯输入边界测试和 2 项进程回归；SessionStart 完整快照、Stop 受管区块范围、原始 transcript 只读、报告、评分、阈值和压缩行为均未改变。

### Stop hook `stop_hook_active` 重入语义审计（2026-08-06）

- Claude 官方 hooks 文档确认：`stop_hook_active=true` 表示 Claude 已因 Stop hook 的继续决定再次进入停止流程；检查该值的目的，是避免会阻止停止的 hook 在永远无法满足的条件上循环。
- trimctx Stop hook 始终以 0 退出，且只输出非 JSON 状态文本；按官方输出契约，该文本在 Stop 事件中只进入 debug log，不会通过退出码 2、`decision: "block"` 或 `additionalContext` 阻止停止。
- 本地以同一版本化 fixture 分别传入 `false` / `true` 复验，两次均退出 0、输出逐字节相同、未创建项目 `.claude` 目录，且 transcript SHA-256 不变；诊断临时目录已清理。
- 结论是保持当前非阻塞分析行为，不按 `stop_hook_active=true` 短路：若其他 Stop hook 让 Claude 继续，trimctx 在后续最终 Stop 分析更新后的 transcript 才能保留最新状态。此次审计无需代码变更。

验证命令：

```bash
npm test
npm run build
```

当前结果：

- `npx vitest run tests/platform-files.test.ts tests/platform-files-failure.test.ts tests/hook.test.ts --testTimeout=30000`：3 个测试文件、56 项测试通过
- `npm test`：50 个测试文件、514 项测试通过
- `npx tsc -p tsconfig.json --noEmit --pretty false`：通过
- `npm run build`：通过
- `npx vitest run tests/package-contents.test.ts`：packed/fresh-install 5 项测试通过
- `npm pack --dry-run --json --silent`：22 个发布文件
- `git diff --check`：通过，仅有既有 LF -> CRLF 提示

### Phase 0 自动验证进度

`reports/phase0/validation-summary.md` 已记录 5 个 Claude Code 私有样本的聚合验证结果：

- 总 messages：5,681
- 总 tokens：1,426,860
- 总 remove candidates：351
- 总 compress candidates：245
- 所有样本压缩前后原始文件 hash 均未变化

项目负责人已经确认现有功能在真实工作流中可行；后续私有验证作为回归记录，不再作为继续 CLI 稳定化和结构重构的前置条件。这不等同于宣称 `phase0_trust` 已锁定；未来若对外承诺无需人工审查的压缩安全性，仍需满足正式 Phase 0 发布门槛。

## 已修复的问题

真实 Claude Code JSONL 文件开头不一定是普通 `user/assistant` 消息，可能包含：

- `mode`
- `permission-mode`
- `file-history-snapshot`
- `attachment`
- `ai-title`
- `last-prompt`
- system meta event

已修复自动检测逻辑：现在会扫描前 25 条记录判断格式，而不是只看第一行。

## 真实样本验证

### 样本 1

路径：

```text
C:\Users\kele\.claude\projects\C--Users-kele\fffc50ff-b984-4dd8-8cd0-bcc6aa583b43.jsonl
```

结果：

- 11 条记录
- 能解析
- 因样本太短，最近 30 条消息规则导致全部 protected
- 不适合验证清理效果

### 样本 2

路径：

```text
C:\Users\kele\.claude\projects\E--xxyWork-heli-ml-museum\5c574dba-0f62-406b-980b-a098da258ddd.jsonl
```

调校前结果：

- 633 条记录
- 约 1.58MB
- 能解析
- 总 tokens：218,385
- protected：481
- keep：151
- compress_candidate：1
- remove_candidate：0

调校后结果：

- protected：338
- keep：224
- compress_candidate：30
- remove_candidate：41
- 预计节省：5,592 tokens
- 原始文件 hash 验证不变

结论：

parser 可用，scorer/safety 已经能在真实长会话里产出一批可解释的低风险候选。下一步重点转向 Phase 0 多样本验证。

## 已缓解的问题

### 1. protected 曾经过多

调校前，真实长会话中 633 条记录有 481 条 protected。

主要原因：

- `recent_message`：241 条
- `references_tool_result`：161 条
- `tool_result_referenced_later`：144 条
- `contains_file_path`：80 条

调校后：

- protected 降为 338
- `references_tool_result` 降为 17
- `tool_result_referenced_later` 降为 17
- 出现 41 条 `remove_candidate` 和 30 条 `compress_candidate`

### 2. tool_use / tool_result 保护策略已收窄

调校前逻辑是：

- tool_use 提到 tool id，则 protected
- tool_result 被引用，则 protected

这在安全上保守，但会导致大量旧工具调用无法成为候选。

应该改成：

- 最近工具结果保护
- 被最终结论引用的工具结果保护
- 旧的重复 Read/Grep/Glob 结果可成为压缩候选
- 旧 tool_use 调用本身通常不需要永久 protected

当前已实现：

- 旧 tool_use 不再因为自身 tool id 被自动 protected
- tool_result 只有被后续非工具自然语言消息引用时才 protected
- 真实样本中的 tool 引用保护数量明显下降

### 3. 元事件已经加入低价值评分

以下事件通常不应长期占用上下文：

- `file-history-snapshot`
- `ai-title`
- `mode`
- `permission-mode`
- 大块 `skill_listing`
- 大块 `mcp_instructions_delta`

当前已实现 `low_value_metadata` / `low_value_score`，真实样本首批候选主要来自 `file-history-snapshot`、`ai-title`、`last-prompt` 和大块 MCP instruction attachment。

## 当前主要问题

### 1. Phase 0 信任门仍未锁定

当前工作流和保守压缩策略已经可用于本地审查，但这不等同于可以对外承诺“无需人工复核的压缩安全”。正式承诺仍需要多样本人工审查指标和真实私有 OpenAI export 验证。

### 2. Report v2 需要代表性样本复核

`trimctx.report.v2` 已提供结构化 evidence、独立 assessment、findings、review queue 和 candidate groups。下一步应检查这些结果是否准确、可解释、可操作，优先修正文案和误报，不扩大自动删除范围。

### 3. 集成边界需要持续保持明确

SessionStart hook 通过 `CLAUDE_ENV_FILE` 写当前会话绑定；Stop hook 可能更新项目 `.claude/CLAUDE.md` 中由 trimctx 管理的上下文状态区块。原始 transcript 始终只读，绑定式分析与显式压缩继续分离。

## 下一步执行顺序

### Step 1：复核 Report v2 质量

- 使用代表性 Claude Code / Codex 会话检查健康结论、findings 和 review queue。
- 记录误报、漏报和 continuation readiness 缺口。
- 只在证据充分时调整规则或展示文案。

### Step 2：补齐 Phase 0 发布证据

- 完成多样本人工审查指标。
- 补充真实私有 OpenAI export 验证。
- 在门槛满足前继续保留人工审查提示。

### Step 3：保持发布与集成质量门

- 保持 Windows packed-install、tarball 资产清单和 fresh-install smoke 覆盖。
- 保持 `init`、`analyze`、`report`、`export`、`new-chat`、`compress` 六个公开命令、内部 hook executor 和原始 transcript 只读契约。
- 发布前运行测试、构建和 package contents 检查。

Stop hook 的 `last_assistant_message` 完整性语义已完成审计和修复：Claude 部分版本在 Stop 时不保证 transcript 已包含最终 assistant 回复，原实现只分析 `transcript_path`，可使压力、保护比例和 resume 证据落后一轮。当前实现会在 Stop 专用只读分析边界中按需追加一条内存 assistant 消息；只统一换行和首尾空白后与最新已解析 assistant 完全相等时去重，更早的同文回复不视为当前回合已落盘。

该补全不写回 transcript，不进入公共 `analyze` / `report` / `export` / `compress` / `new-chat`，也不改变 scorer、recent window 或压力阈值。50k token 边界的真实 CLI 子进程回归已经覆盖 low -> medium 压力转换、CLAUDE.md 受管区块更新和 transcript SHA-256 不变；非字符串字段在任何项目状态写入前失败且不回显内容。

Phase 0 最终信任门也已完成闭环修复：原 `phase0:review` 只计算人工标签指标，单一报告和单一来源也可错误得到 `trust_status: locked`。当前 review 会自动读取 reports 同目录的 `phase0-results.json`，从逐样本结果重算 analyze/report/compress 成功率、输入不变数和来源覆盖，并要求成功 report ID 集合与实际 `*.report.json` 完全一致；sanitize-name 碰撞、陈旧/缺失报告和 aggregate 矛盾都会阻止锁定。

批次证据缺失、不一致、少于 5 个样本或 Claude/OpenAI/Codex 覆盖不足时状态为 `review_required`；结构与覆盖完整但执行率或输入只读门失败时为 `failed`；只有批次执行门和人工安全门同时通过才可能为 `locked`。review 工件升级为 `trimctx.phase0.review.v2`，JSON/Markdown 只输出聚合数字和固定 issue code，并移除既有 reports/labels 绝对路径，不复制 stderr、error、消息正文或 review note；scorer、threshold、compression 和公开 CLI 均未改变。

Phase 0 report artifact 质量门也已补齐：当前 report 不是 `trimctx.report.v2`、非对象 message、缺失或样本内重复 ID、非法 decision/protected/rot_score，以及 decision 与 protected 不一致都会分别聚合计数；任一计数非零均强制 `review_required`，不再让旧 schema 报告、重复 ID 复用同一 label 或 malformed message 缩小审查分母。JSON/Markdown 只展示固定分类与数字，不回显 schema 原值、ID、非法值、路径或正文；该检查只覆盖 trust gate 依赖的最小字段，不宣称完整 Report v2 schema validation，也不改变合法报告的既有指标和阈值。

Phase 0 review 的 JSON/Markdown 双工件写入也已收紧：两个完整正文先写入目标同级 exclusive stage，再通过 backup + rename 作为一个进程内事务提交；第二目标失败会恢复既有工件或删除本次新建目标，不再留下新旧版本混合。operation、restore 与 stage cleanup 错误会聚合，无法恢复的 backup 或无法删除的 stage 保留供人工处理；backup cleanup 在新工件对已一致提交后失败时也保留恢复材料并返回错误。强制终止、断电与并发 review writer 仍不提供持久化 journal 或锁；schema、metrics、trust gate、scorer、threshold、compression 和公开六命令均未改变。

Phase 0 label 必填字段也已进入质量门：过去非法或缺失 decision 会被静默降为 undefined 并绕过 report mismatch，空 review note 也能参与完整审查，二者在其他 gate 通过时可错误得到 `locked`。当前 review 分别聚合 `invalid_label_decisions` 与 `missing_review_notes`，并计入 `label_quality_issues` 强制 `review_required`；输出只含固定分类和数字，不保留或回显 decision 原值与 note。sample/message/label 的既有硬校验、引用/重复/mismatch、人工指标和阈值均未改变，本检查也不宣称完整 label schema validation。

Phase 0 label 类别兼容性也已进入质量门：删除类标签只能标注 `remove_candidate`，protected 类标签只能标注 protected 消息，`missed_low_value_noise` 只能标注未 protected 的非删除消息。过去额外的语义错误标签只要 decision 字段与 report 一致，就可能在完整证据下被忽略并仍得到 `locked`；当前 review 聚合 `incompatible_label_categories` 并计入 `label_quality_issues`，输出仍只含固定分类和数字，不回显 label 原值、message ID、正文或 review note。该检查不改变 scorer、threshold、protected/candidate decision 或 compression。

Phase 0 人工指标分母也已收紧：`remove_candidates_reviewed`、`protected_reviewed`、critical protected reviewed 和 protected sample coverage 只统计唯一、字段完整、decision 与 report 匹配、类别兼容的有效 label。`critical_keep` 贴在 `remove_candidate` 上仍作为保守安全信号计入 `critical_false_deletion`，即使该 label 另有审计质量问题；因此输出不会再把缺 note、非法 decision 或重复/不兼容 label 显示成已完成审查或 100% recall。

Phase 0 critical label 命名也已统一：规范标签名是 `critical_keep`，但 `phase0:review` 兼容旧 rubric 中的 `critical_false_delete` 并在解析时归一为 `critical_keep`。review JSON/Markdown 仍不输出原始 label 或 review note；该兼容只避免旧私有标注文件硬失败，不改变 critical false deletion 指标或信任门语义。

Phase 0 rubric 中的 `needs_summary` 与 `unclear` 已和 `phase0:review` 对齐：`needs_summary` 只接受非删除消息，`unclear` 可标注任意被审查消息；二者作为非锁定证据聚合输出，但不计入 remove precision、protected recall 或 protected coverage 分母，也不能满足 Phase 0 锁定所需的必审项。该兼容避免私有标签按通用 rubric 标注时硬失败，不改变 scorer、threshold、protected/candidate decision 或 compression。

`phase0:run` 生成的 `validation-summary.md` 和 Phase 0 validation summary 模板也已补齐 protected review coverage、`Needs summary` 与 `Unclear` 的人工审查占位，避免预审摘要与当前人工 rubric 脱节。该变更只影响开发期 Phase 0 Markdown summary 的占位呈现，不改变 results schema、review metrics、scorer、threshold、protected/candidate decision 或 compression。

Phase 0 review 的输入与错误呈现边界也已收紧：malformed report JSON、malformed label JSON 和非对象 label record 会在工件提交前失败，stderr 只给稳定的文件/行号诊断，不透传 JSON parser 文案、私有输入或内部字段访问异常，既有 JSON/Markdown 工件保持逐字节不变。事务抛出嵌套 `AggregateError` 时，CLI 现在按原顺序递归打印所有叶子原因，不再只显示顶层摘要而隐藏 commit、restore 或 cleanup 失败；格式化只读取 error message，不读取 stack 或附加的工件数据。

`phase0:run` 的批次写入边界也已收紧：原脚本逐样本规范化文件名并立即写入，`a b.jsonl` 与 `a_b.jsonl` 一类输入会映射到同一 ID，后一个样本静默覆盖前一个 report/trimmed 工件；输入与输出为同一目录时，旧 trimmed 文件还可能污染后续批次。当前脚本会在 `mkdir`、CLI 子进程和任何输出写入前解析真实目录、拒绝 input/output 同目录或 junction/symlink 别名，并为全部输入预先规划输出、拒绝字符替换、120 字符截断或 Windows 大小写等价后的重名。正常文件名、结果 schema、review ID、scorer、threshold、compression、公开六命令和原 transcript 只读契约均未改变。

`phase0:run` 的最终证据对也已改为事务写入：过去脚本先直接覆盖 `phase0-results.json`，再写 `validation-summary.md`，第二目标失败会丢失旧 JSON 并留下混合快照。当前 run/review 共用一个 script-scoped 双文本工件事务内核，两个完整正文都 exclusive staging 后才通过 backup + rename 提交；可恢复失败还原旧对，restore/cleanup 失败聚合全部原因并保留 recovery artifact。强制终止、断电、操作系统崩溃与并发 writer 仍无 journal/锁保证；逐样本 report/trimmed、results schema、scorer、threshold、compression、公开六命令和原 transcript 只读契约均未改变。

`phase0:run` 的逐样本结果语义也已收紧：过去 analyze/report/compress 子进程只要退出 0 就先计为成功，有效 report 还会掩盖无效的 `analyze --json` stdout；report/trimmed 工件缺失会误计成功，损坏 report JSON 则会中止整个批次而丢失最终证据。当前逐样本模块独立验证 analyze JSON、report JSON 工件和 compressed 工件；空白、malformed、非对象、缺失、非普通文件或读取失败均保留真实 `exit_code` 但记录 `ok: false`，只降低对应 gate 并把该样本列入 `failed_samples`，批次继续生成最终证据。压缩工件读取精确字节；有有效 report 时还会按来源 adapter 重读并核对排除 `remove_candidate` 后的规范化消息多重集，只有通过才记录 SHA-256。失败 compress 进程不会检查可能陈旧的目标，固定错误也不回显正文、identity、parser 片段或 stack。元数据优先取有效 report，失败时回退有效 analyze；成功输出、命令顺序、results schema 版本、scorer、threshold、compression、公开六命令和原 transcript 只读契约均未改变。

Phase 0 的 analyze/report 成功门现已进一步要求最小 `trimctx.report.v2` 契约：schema 版本、输入来源、核心非负 summary/score diagnostics、消息与候选数组以及字符串 warnings 都必须可供后续聚合使用。合法 JSON 但结构无效的对象会保留子进程退出码并以固定隐私安全错误降为失败，不再抬高成功计数；malformed 或非对象 JSON 继续使用原错误分类。该守卫不读取或回显非法值，也不宣称完整 Report v2 schema validation；message 级质量仍由 `phase0:review` 的既有门负责，评分、阈值、压缩和六命令契约未改。

Report v2 continuation 证据也已完成代表性样本复核与来源收紧。两份 Claude 和两份 Codex 私有报告的原结构与候选计数均有效，但修复前两份 Claude 的 current goal 以及各 6 条 decisions 全部来自 adapter 包装成 user 的 `tool_result`，tool body 还会继承高/中置信度并把大段结果中的路径计为 active files。当前 goal/decision/next step 只接受非 tool 的用户或助手正文，active files 接受正文与 `tool_use` 但拒绝 `tool_result`，failure/test 仍保留 tool 诊断但统一为 low confidence；readiness 只为 medium/high 证据计权。四份报告复验后 conversational tool origin、active-file tool-result origin 和 non-low tool diagnostics 均为 0；两个 Claude readiness 从 100/75 收敛到 90/65 并显式暴露 active-file/next-step 缺口，两个仍有可信正文证据的 Codex 样本保持 ready。所有输入 SHA-256、message/protected/remove/compress 数量和引用不变量均未变化，scorer、threshold、compression、六命令和原 transcript 只读契约未改。

### Step 4：冻结高风险扩展

暂不推进 Web UI、MCP、后台监控、自动压缩、LLM summarization 或更激进删除阈值。

## 当前结论

项目已完成本轮命令面收敛、evidence-based Report v2、文件写入保护和集成说明更新；完整规范化 `export` 命令是经批准的有限例外，不改变评分或压缩边界。项目继续处于“复核报告质量并积累正式信任证据”的阶段。

当前最重要任务：

**用代表性样本审查 Report v2，补齐 Phase 0 证据，同时保持现有命令和安全边界稳定。**
