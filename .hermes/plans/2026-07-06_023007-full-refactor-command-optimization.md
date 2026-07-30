# trimctx 全面重构与命令优化长任务计划

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在保持现有 CLI 用户契约、安全边界和发布包可用性的前提下，系统性重构 `/home/now/文档/work/trimContext`，移除旧代码冗余逻辑，按现有命令体系深度优化项目结构、测试矩阵、文档口径与 Phase 0 验证能力。

**Architecture:** 采用“先锁定行为基线，再拆命令层，再稳定核心 pipeline，再下沉 adapter 能力，再统一 reason metadata，最后收敛文档与发布门禁”的渐进式重构。每阶段只允许小步迁移，保留 facade/re-export 兼容层，所有用户可见行为必须由测试和 smoke 输出证明没有漂移。

**Tech Stack:** Node.js 20+ / TypeScript / commander / vitest / esbuild / npm package / 本地 JSONL parser。

---

## 0. 现场基线与审计结论

### 0.1 已验证仓库状态

项目路径：`/home/now/文档/work/trimContext`

当前只读检查结果：

- Git 分支：`main...origin/main`
- 工作区：检查时干净
- 包名：`trimctx`
- 当前版本：`0.2.9`
- CLI bin：`dist/cli.js`
- 核心源码：`src/` 共约 28 个 TypeScript 文件，约 3517 行
- 测试：`tests/` 共 18 个测试文件，约 3230 行
- 文档：`docs/` 共约 21 个文档文件，约 8063 行

QA 子审计真实质量门：

```text
npm test                  -> 18 files passed, 134 tests passed
npm run build             -> passed
git diff --check          -> passed
npm pack --dry-run --json -> passed, trimctx-0.2.9.tgz, 22 entries
```

### 0.2 当前必须保留的命令契约

核心用户命令：

```bash
trimctx
trimctx analyze [file]
trimctx report <file> -o <report.json>
trimctx compress <file> -o <output.jsonl>
trimctx current [--source auto|claude|codex]
trimctx new-chat [file]
trimctx init
```

兼容/实验命令：

```bash
trimctx handoff [file]       # new-chat 的兼容别名
trimctx hook                 # Claude hook runtime，需降级为 internal/experimental
trimctx install-hooks        # Claude hook installer，需重审默认副作用
```

### 0.3 当前最主要问题

1. `src/cli.ts` 已成为 700+ 行 God File，混合命令注册、参数解析、安装器、hook installer、handoff package、文件安全、版本读取、交互式 prompt。
2. 输出路径安全逻辑重复：`src/cli.ts` 与 `src/core/compressor.ts` 都有 `sameFile`/同文件保护。
3. `formatTokens`、`formatRatio`、health level、reason labels 在 CLI 摘要和 context state 中重复，容易口径漂移。
4. `parseJsonlRecords()` 放在 `src/core/diagnostics.ts`，但 adapters 依赖它，形成不理想的 `adapters -> core` 方向。
5. 格式探测逻辑硬编码在 `src/core/analyzer.ts`；压缩器对 OpenAI 格式有特殊分支，格式能力泄漏到 core。
6. `Reason` 同时承载 safety、scoring、presentation、trust 语义；hard protect、importance discount、label 分散维护。
7. `src/core/session.ts` 同时做 session discovery、help message、`analyzeFile()` pipeline facade，职责不清。
8. 文档阶段口径不一致：README/usage 已把 `init`、plugin、Codex skill、hooks 作为当前能力，而 roadmap/iteration-plan 仍说 hooks/install 是 deferred/frozen。
9. 安全边界存在潜在误解：`trimctx hook` Stop 模式会写 `.claude/CLAUDE.md`，虽然不写原 JSONL，但属于项目文件副作用。
10. `current --compress` 对 latest session 直接压缩，容易被误解为 current-window 操作，不符合“先 report 审查再 compress”的产品心智。

---

## 1. 重构总原则

### 1.1 行为优先，不做一次性大爆炸

- 每阶段只迁移一个清晰边界。
- 每阶段必须运行对应质量门。
- 任何用户可见输出变化都必须有测试与文档说明。
- 不允许“顺手调算法阈值”或“顺手改 compression 决策”。

### 1.2 安全边界不可回退

必须始终成立：

- 不修改原始 JSONL。
- `protected` 永不删除。
- `compress_candidate` 仍为 report-only，不参与删除。
- `compress` 只删除非 protected 的 `remove_candidate`。
- 所有写文件命令必须显式输出目标或清晰声明目标。
- output 不能与 input 相同；多输出之间不能互相覆盖。
- Phase 0 locked 之前，不宣传“无需审查的自动压缩”。

### 1.3 文档必须与实际能力一致

重构不是只改代码；每个阶段需要同步：

- `README.md`
- `README_zh.md`
- `docs/user/usage.md`
- `docs/user/usage_zh.md`
- `docs/dev/roadmap.md`
- `docs/dev/iteration-plan.md`
- `plugins/trimctx/README.md` 与 command docs（如受影响）
- `codex/skills/trimctx/SKILL.md`（如受影响）

### 1.4 不新增范围

本轮重构明确不做：

- Web UI
- MCP server
- REST API
- LLM summarization
- embedding/semantic detector
- Python sidecar
- `resume <uid>`
- 全局数据库/registry
- 新的 public command 面，除非某阶段计划明确授权

---

## 2. 目标目录结构

最终建议结构：

```text
src/
  cli.ts

  commands/
    index.ts
    default.ts
    analyze.ts
    current.ts
    report.ts
    compress.ts
    new-chat.ts
    init.ts
    hook.ts
    shared/
      analysis-options.ts
      output-safety.ts
      errors.ts

  core/
    pipeline.ts
    options.ts
    reasons.ts
    safety.ts
    scorer.ts
    compressor.ts
    tokenizer/
    report/
      create-report.ts
      summary.ts
      tokenization.ts
      context-pressure.ts
      score-diagnostics.ts
      parser-diagnostics.ts
      trust.ts
      warnings.ts
    resume/
      extractor.ts
      readiness.ts
      markdown.ts

  adapters/
    types.ts
    registry.ts
    content.ts
    claude-code-jsonl.ts
    codex-jsonl.ts
    openai-jsonl.ts

  io/
    jsonl.ts

  sessions/
    types.ts
    discovery.ts
    help.ts

  integrations/
    assets.ts
    claude/
      hooks-runtime.ts
      hooks-install.ts
      settings.ts
    codex/
      assets.ts

  presentation/
    format-summary.ts
    context-state.ts
    handoff.ts
    formatters.ts
    reason-labels.ts

  platform/
    files.ts
    prompt.ts
    package-root.ts

  types/
    message.ts
    report.ts
    resume.ts
```

注意：这是最终形态，不是一次提交内全部完成。

---

## 3. Phase 0：重构前行为基线锁定

**Objective:** 在改动任何生产代码前，保存现有命令行为、report schema、package 文件列表与质量门输出，作为后续对比基线。

**Files:**

- Create: `docs/dev/refactor-baseline.md`
- Create: `tests/fixtures/baseline/`（如需要保存 sanitized baseline JSON）
- Modify: 暂不修改生产代码

### Task 0.1：记录当前命令与质量门基线

**Step 1: 运行质量门**

```bash
cd '/home/now/文档/work/trimContext'
npm test
npm run build
git diff --check
npm pack --dry-run --json
```

Expected:

- `npm test`：全部通过
- `npm run build`：通过
- `git diff --check`：无输出
- `npm pack --dry-run --json`：列出 package 内容

**Step 2: 保存关键命令输出到文档**

记录但不要提交私有 transcript：

```bash
node --import tsx src/cli.ts --help
node --import tsx src/cli.ts --version
node --import tsx src/cli.ts analyze tests/fixtures/claude-code-realistic.jsonl
node --import tsx src/cli.ts analyze tests/fixtures/codex-realistic.jsonl --json
```

**Step 3: 写入 `docs/dev/refactor-baseline.md`**

内容包括：

- 当前版本、分支、质量门结果
- 命令列表
- package 文件列表摘要
- 当前 report schema 关键字段
- 当前非目标清单

**Step 4: 验证文档无私密数据**

```bash
git diff -- docs/dev/refactor-baseline.md
```

Expected:

- 只包含 fixture 与命令元信息
- 不包含真实私有 JSONL 原文

**Step 5: 质量门**

```bash
npm test
npm run build
git diff --check
```

**Commit:**

```bash
git add docs/dev/refactor-baseline.md
git commit -m "docs: capture trimctx refactor baseline"
```

---

## 4. Phase 1：抽出共享工具，移除低风险重复逻辑

**Objective:** 不改变行为，只把重复/纯函数从 `src/cli.ts`、`src/core/compressor.ts`、presentation 文件中抽出。

**Files:**

- Create: `src/platform/files.ts`
- Create: `src/platform/package-root.ts`
- Create: `src/platform/prompt.ts`
- Create: `src/commands/shared/analysis-options.ts`
- Create: `src/commands/shared/output-safety.ts`
- Create: `src/presentation/formatters.ts`
- Create: `src/presentation/reason-labels.ts`
- Modify: `src/cli.ts`
- Modify: `src/core/compressor.ts`
- Modify: `src/cli/format-summary.ts`
- Modify: `src/core/context-state.ts`
- Test: `tests/cli-commands.test.ts`, `tests/compressor.test.ts`, `tests/context-state.test.ts`, `tests/format-summary.test.ts`

### Task 1.1：抽文件安全工具

**Step 1: 添加回归测试**

在 `tests/cli-commands.test.ts` 或 `tests/compressor.test.ts` 确认已有以下测试；没有则补：

- `compress` 拒绝 input 与 output 同路径
- `report` 拒绝 input 与 output 同路径
- `new-chat` legacy `-o` 拒绝 input 同路径
- `new-chat --next-context` 拒绝 input 同路径
- 多输出文件互相相同时拒绝

**Step 2: 新建 `src/platform/files.ts`**

导出：

```ts
export function sameFile(left: string, right: string): boolean
export function assertDifferentFiles(left: string, right: string, message: string): void
```

实现必须保留当前 `realpathSync` + `resolve` fallback 语义。

**Step 3: 改 `src/cli.ts` 和 `src/core/compressor.ts`**

- 删除本地重复 `sameFile()`。
- 使用 `src/platform/files.ts`。
- 保持错误文案兼容。

**Step 4: 运行测试**

```bash
npx vitest run tests/cli-commands.test.ts tests/compressor.test.ts
npm run build
```

Expected: pass。

### Task 1.2：抽分析参数解析

**Step 1: 新建 `src/commands/shared/analysis-options.ts`**

迁移：

- `parseAnalysisOptions()`
- `parseOptionalInteger()`
- `parseOptionalNumber()`

**Step 2: 保持 core/options.ts 职责不变**

`src/core/options.ts` 继续负责 typed options 校验与默认值。

**Step 3: 运行 CLI 参数测试**

```bash
npx vitest run tests/cli-commands.test.ts
npm run build
```

### Task 1.3：抽 presentation formatters 与 reason labels

**Step 1: 新建 `src/presentation/formatters.ts`**

导出：

```ts
formatTokens(tokens?: number): string
formatRatio(value?: number): string
```

**Step 2: 新建 `src/presentation/reason-labels.ts`**

导出统一 `REASON_LABELS` 与 `labelReason(reason)`。

**Step 3: 修改使用方**

- `src/cli/format-summary.ts`
- `src/core/context-state.ts`

**Step 4: 运行测试**

```bash
npx vitest run tests/format-summary.test.ts tests/context-state.test.ts
npm test
npm run build
```

**Commit:**

```bash
git add src tests
git commit -m "refactor: extract shared cli safety and presentation helpers"
```

---

## 5. Phase 2：拆分 CLI 命令模块

**Objective:** 将 `src/cli.ts` 缩小为 commander 根程序与命令注册，不改变任何命令名、参数名或默认行为。

**Files:**

- Create: `src/commands/index.ts`
- Create: `src/commands/default.ts`
- Create: `src/commands/analyze.ts`
- Create: `src/commands/current.ts`
- Create: `src/commands/report.ts`
- Create: `src/commands/compress.ts`
- Create: `src/commands/new-chat.ts`
- Create: `src/commands/init.ts`
- Create: `src/commands/hook.ts`
- Modify: `src/cli.ts`
- Test: `tests/cli-commands.test.ts`, `tests/cli-analyze.test.ts`, `tests/hook.test.ts`, `tests/package-contents.test.ts`

### Task 2.1：建立命令注册骨架

**Step 1: 新建 `src/commands/index.ts`**

导出：

```ts
export function registerCommands(program: Command): void
```

内部调用各 `registerXCommand(program)`。

**Step 2: 修改 `src/cli.ts`**

保持：

- shebang
- `createProgram()` 或根 program 初始化
- version
- root options
- `program.parseAsync()`

其余命令注册逐步移出。

**Step 3: Smoke**

```bash
node --import tsx src/cli.ts --help
node --import tsx src/cli.ts --version
npm run build
```

### Task 2.2：迁移 analyze/report/compress/current/default

**Step 1: 逐个移动命令**

迁移顺序：

1. `analyze`
2. `report`
3. `compress`
4. `current`
5. root default action

**Step 2: 每迁移一个命令运行 focused tests**

```bash
npx vitest run tests/cli-analyze.test.ts tests/cli-commands.test.ts
npm run build
```

**Step 3: 对比 help**

确认：

```bash
node --import tsx src/cli.ts --help
```

命令名仍包含：`init/current/analyze/report/compress/new-chat/handoff/hook/install-hooks`。

### Task 2.3：迁移 new-chat/handoff

**Step 1: 新建 `src/commands/new-chat.ts`**

要求：

- `new-chat` 为主命令。
- `handoff` 只作为 alias 注册，不复制业务逻辑。
- 保留 default UID package。
- 保留 legacy `-o --next-context`。
- 保留互斥校验。

**Step 2: focused tests**

```bash
npx vitest run tests/cli-commands.test.ts -t "new-chat|handoff"
npm run build
```

### Task 2.4：迁移 init/hook/install-hooks

**Step 1: 新建 `src/commands/init.ts` 与 `src/commands/hook.ts`**

先只搬迁，不改 hook 行为。

**Step 2: focused tests**

```bash
npx vitest run tests/cli-commands.test.ts tests/hook.test.ts tests/package-contents.test.ts
npm run build
```

### Task 2.5：完整质量门

```bash
npm test
npm run build
git diff --check
npm pack --dry-run --json
git status --short
```

**Commit:**

```bash
git add src tests
git commit -m "refactor: split cli commands into modules"
```

---

## 6. Phase 3：拆分 session discovery 与 core pipeline

**Objective:** 解耦“发现最新会话文件”和“分析输入文件”的职责，让 CLI、hook、scripts 共用稳定 pipeline。

**Files:**

- Create: `src/core/pipeline.ts`
- Create: `src/sessions/types.ts`
- Create: `src/sessions/discovery.ts`
- Create: `src/sessions/help.ts`
- Modify: `src/core/session.ts`（临时 facade）
- Modify: `src/commands/*` imports
- Modify: `src/core/hook.ts` 或后续 integrations runtime imports
- Test: `tests/cli-commands.test.ts`, `tests/hook.test.ts`, `tests/reporter.test.ts`

### Task 3.1：迁移 `analyzeFile()` 到 `src/core/pipeline.ts`

**Step 1: 新建 pipeline facade**

导出：

```ts
export async function analyzeFile(file: string, options?: AnalysisOptions): Promise<AnalysisReport>
```

内部保持当前实现。

**Step 2: `src/core/session.ts` re-export**

暂时保留旧 import 兼容：

```ts
export { analyzeFile } from "./pipeline.js";
```

**Step 3: 测试**

```bash
npm test
npm run build
```

### Task 3.2：迁移 session source 类型与 discovery

**Step 1: 新建 `src/sessions/types.ts`**

迁移：

- `SessionSource`
- `parseSessionSource()`

**Step 2: 新建 `src/sessions/discovery.ts`**

迁移：

- `sessionRoots()`
- `findLatestJsonlUnder()`
- `findLatestSession()`
- `resolveCurrentSessionFile()`

**Step 3: 新建 `src/sessions/help.ts`**

迁移：

- `formatNoSessionHelp()`
- `prettyHomePath()`

**Step 4: 更新 imports**

优先让 command modules 使用新路径。`src/core/session.ts` 保留 re-export。

**Step 5: 质量门**

```bash
npx vitest run tests/cli-commands.test.ts tests/hook.test.ts
npm test
npm run build
```

**Commit:**

```bash
git add src tests
git commit -m "refactor: separate session discovery from analysis pipeline"
```

---

## 7. Phase 4：Adapter registry 与 JSONL 基础层

**Objective:** 将格式探测和格式特定压缩能力下沉到 adapter 层，消除 `core/analyzer.ts` 与 `core/compressor.ts` 对具体格式的硬编码。

**Files:**

- Create: `src/io/jsonl.ts`
- Create: `src/adapters/types.ts`
- Create: `src/adapters/registry.ts`
- Modify: `src/core/diagnostics.ts`
- Modify: `src/core/analyzer.ts`
- Modify: `src/core/compressor.ts`
- Modify: `src/adapters/claude-code-jsonl.ts`
- Modify: `src/adapters/codex-jsonl.ts`
- Modify: `src/adapters/openai-jsonl.ts`
- Test: parser tests, compressor tests, fixture regression tests

### Task 4.1：移动 JSONL parser

**Step 1: 新建 `src/io/jsonl.ts`**

迁移：

- `parseJsonlRecords()`
- `JsonlRecord` 类型（如当前存在）

**Step 2: `src/core/diagnostics.ts` 保留 re-export 或 diagnostics-only**

短期兼容：

```ts
export { parseJsonlRecords } from "../io/jsonl.js";
```

**Step 3: 更新 adapters imports**

将：

```ts
../core/diagnostics.js
```

替换为：

```ts
../io/jsonl.js
```

**Step 4: 测试**

```bash
npx vitest run tests/parser-diagnostics.test.ts tests/parser.*.test.ts
npm run build
```

### Task 4.2：建立 adapter registry

**Step 1: 新建 `src/adapters/types.ts`**

定义：

```ts
export interface ConversationAdapter {
  source: MessageSource;
  detect(records: JsonlRecord[]): boolean;
  parse(input: string, file?: string): NormalizedMessage[];
  serializeCompressed?: (
    input: string,
    analyzed: NormalizedMessage[],
    removeIds: Set<string>
  ) => string;
}
```

具体类型按现有 `NormalizedMessage`/`AnalyzedMessage` 调整。

**Step 2: 每个 adapter 导出 adapter object**

例如：

```ts
export const openAiJsonlAdapter: ConversationAdapter = {
  source: "openai-jsonl",
  detect: looksLikeOpenAiRecord,
  parse: parseOpenAiJsonl,
  serializeCompressed: compressOpenAiJsonl,
};
```

**Step 3: 新建 `src/adapters/registry.ts`**

提供：

```ts
export function detectAdapter(records: JsonlRecord[]): ConversationAdapter | undefined
export const adapters: ConversationAdapter[]
```

检测顺序必须保持：Claude Code → Codex → OpenAI。

**Step 4: 修改 `src/core/analyzer.ts`**

核心 analyzer 不再 import 具体 adapter parse 函数；只通过 registry 选择 adapter。

**Step 5: 测试**

```bash
npx vitest run tests/parser.claude-code-jsonl.test.ts tests/parser.codex-jsonl.test.ts tests/parser.openai-jsonl.test.ts tests/fixture-regression.test.ts
npm run build
```

### Task 4.3：压缩策略 adapter 化

**Step 1: 为 OpenAI adapter 提供 `serializeCompressed`**

迁移当前 `compressOpenAiLines()` 逻辑。

**Step 2: 为 Claude/Codex 提供默认 line-preserving serializer**

保守规则：

- 遍历原始输入行。
- 没有归一化消息的行原样保留。
- 有归一化消息的行，只有当该 `sourceLine` 上所有消息都被 remove 时才删除整行。

**Step 3: 修改 `src/core/compressor.ts`**

核心只：

- 调 pipeline/report 获取 decisions。
- 获取 adapter serializer。
- 写输出。

**Step 4: 必跑测试**

```bash
npx vitest run tests/compressor.test.ts tests/parser.openai-jsonl.test.ts tests/parser.codex-jsonl.test.ts
npm test
npm run build
```

**Commit:**

```bash
git add src tests
git commit -m "refactor: introduce adapter registry and format-owned compression"
```

---

## 8. Phase 5：统一 reason metadata

**Objective:** 让 hard protect、importance discount、presentation label、top reason 聚合使用同一份 reason 元数据，降低安全规则漂移风险。

**Files:**

- Create: `src/core/reasons.ts`
- Modify: `src/core/safety.ts`
- Modify: `src/core/scorer.ts`
- Modify: `src/presentation/reason-labels.ts`
- Modify: `src/cli/format-summary.ts`
- Modify: `src/core/context-state.ts`
- Test: `tests/safety.test.ts`, `tests/scorer.test.ts`, `tests/format-summary.test.ts`, `tests/context-state.test.ts`

### Task 5.1：建立 `REASON_META`

**Step 1: 新建 `src/core/reasons.ts`**

定义：

```ts
export interface ReasonMeta {
  category: "safety" | "scoring" | "diagnostic";
  hardProtect: boolean;
  importanceDiscount?: number;
  label: string;
  showInSummary: boolean;
}

export const REASON_META: Record<Reason, ReasonMeta> = { ... };
```

**Step 2: 用类型确保覆盖所有 `Reason`**

如果新增 reason 未配置 metadata，TypeScript 必须报错。

### Task 5.2：替换 safety/scorer/presentation 的重复常量

**Step 1: safety 使用 `isHardProtectReason(reason)`**

**Step 2: scorer 使用 `importanceDiscountFor(reason)`**

**Step 3: presentation 使用 `labelReason(reason)`**

**Step 4: 测试**

```bash
npx vitest run tests/safety.test.ts tests/scorer.test.ts tests/format-summary.test.ts tests/context-state.test.ts
npm test
npm run build
```

### Task 5.3：回归检查候选分布

用 fixtures 生成 report，比较：

```bash
node --import tsx src/cli.ts report tests/fixtures/codex-realistic.jsonl -o /tmp/codex-report.json
node --import tsx src/cli.ts report tests/fixtures/claude-code-realistic.jsonl -o /tmp/claude-report.json
```

Expected:

- `protected` 不减少。
- `remove_candidates` 不异常增加。
- 每个 candidate reasons 非空。

**Commit:**

```bash
git add src tests
git commit -m "refactor: centralize reason metadata"
```

---

## 9. Phase 6：Reporter 分包并稳定 report schema

**Objective:** 将 `src/core/reporter.ts` 拆成小模块，但保持 `AnalysisReport.schema_version === "trimctx.report.v1"` 与字段兼容。

**Files:**

- Create: `src/core/report/create-report.ts`
- Create: `src/core/report/summary.ts`
- Create: `src/core/report/tokenization.ts`
- Create: `src/core/report/context-pressure.ts`
- Create: `src/core/report/score-diagnostics.ts`
- Create: `src/core/report/parser-diagnostics.ts`
- Create: `src/core/report/trust.ts`
- Create: `src/core/report/warnings.ts`
- Modify: `src/core/reporter.ts`（re-export facade）
- Test: `tests/reporter.test.ts`, `tests/phase0-summary.test.ts`, `tests/phase0-review.test.ts`, `tests/cli-analyze.test.ts`

### Task 6.1：拆 summary/tokenization/pressure

**Step 1: 抽 `summary.ts`**

只移动纯 summary 计算。

**Step 2: 抽 `tokenization.ts` 与 `context-pressure.ts`**

保持字段名不变：

- `summary.token_estimation`
- `summary.token_breakdown`
- `summary.context_pressure`
- 顶层 `tokenization`

**Step 3: 测试**

```bash
npx vitest run tests/reporter.test.ts tests/tokenizer-resume.test.ts
npm run build
```

### Task 6.2：拆 diagnostics/trust/warnings

**Step 1: 抽 `parser-diagnostics.ts`**

**Step 2: 抽 `trust.ts`**

必须保持 Phase 0 口径：无人工评审时 `review_required`。

**Step 3: 抽 `warnings.ts`**

**Step 4: 测试**

```bash
npx vitest run tests/phase0-summary.test.ts tests/phase0-review.test.ts tests/reporter.test.ts
npm test
npm run build
```

### Task 6.3：Schema baseline 对比

对 fixture：

```bash
node --import tsx src/cli.ts analyze tests/fixtures/codex-realistic.jsonl --json > /tmp/after.json
```

检查关键字段仍存在：

- `schema_version`
- `input`
- `summary`
- `messages`
- `remove_candidates`
- `phase0_trust`
- `parser_diagnostics`
- `tokenization`
- `resume`

**Commit:**

```bash
git add src tests
git commit -m "refactor: split report generation modules"
```

---

## 10. Phase 7：Integrations 拆分与副作用降级

**Objective:** 将 Claude/Codex asset 安装、Claude hook runtime、hook installer 从 CLI/core 中拆出，并重审默认副作用。

**Files:**

- Create: `src/integrations/assets.ts`
- Create: `src/integrations/claude/hooks-runtime.ts`
- Create: `src/integrations/claude/hooks-install.ts`
- Create: `src/integrations/claude/settings.ts`
- Create: `src/integrations/codex/assets.ts`
- Modify: `src/commands/init.ts`
- Modify: `src/commands/hook.ts`
- Modify: `src/core/hook.ts`（可能改为 facade 或删除）
- Modify: docs as needed
- Test: `tests/cli-commands.test.ts`, `tests/hook.test.ts`, `tests/package-contents.test.ts`

### Task 7.1：拆 asset installer

**Step 1: 新建 `src/integrations/assets.ts`**

迁移：

- package root 定位
- asset source path 解析
- replace/copy directory
- user/project target 路径

**Step 2: `src/commands/init.ts` 只做 CLI 参数解析与调用**

**Step 3: 测试**

```bash
npx vitest run tests/cli-commands.test.ts -t "init"
npm run build
```

### Task 7.2：拆 hooks runtime/install

**Step 1: 新建 `hooks-runtime.ts`**

迁移：

- `runHook()`
- `writeSessionEnvBinding()`
- stop hook runtime 逻辑

**Step 2: 新建 `hooks-install.ts` 与 `settings.ts`**

迁移：

- settings path 解析
- JSON merge
- idempotent install
- dry-run 行为

**Step 3: 保持现有行为，先不改默认副作用**

**Step 4: 测试**

```bash
npx vitest run tests/hook.test.ts tests/cli-commands.test.ts -t "install-hooks|hook"
npm run build
```

### Task 7.3：产品决策：Stop hook 写 `.claude/CLAUDE.md` 降级

这是用户价值与安全边界的关键决策。推荐方案：

- `trimctx hook --session-start` 保留，用于 `TRIMCTX_TRANSCRIPT_PATH` 绑定。
- Stop hook 写 `.claude/CLAUDE.md` 改为 opt-in，例如安装时需要 `--with-context-state` 或设置项。
- `trimctx init --with-hooks` 默认只安装 SessionStart，除非显式 opt-in Stop hook。
- README/usage 明确列出 hooks 会写哪些文件。

**Step 1: 写 failing tests**

覆盖：

- 默认 install-hooks 不安装 Stop hook 写 CLAUDE.md（如果采用此方案）。
- 显式 opt-in 才安装 Stop hook。
- `--dry-run` 展示将写入的 hooks。
- 旧 settings merge 不删除用户已有 hooks。

**Step 2: 实现最小改动**

**Step 3: 同步文档**

更新：

- `README.md`
- `README_zh.md`
- `docs/user/usage.md`
- `docs/user/usage_zh.md`
- `docs/dev/roadmap.md`
- `docs/dev/iteration-plan.md`

**Step 4: 质量门**

```bash
npm test
npm run build
npm pack --dry-run --json
git diff --check
```

**Commit:**

```bash
git add src tests README.md README_zh.md docs plugins codex
git commit -m "refactor: isolate integrations and make hook side effects explicit"
```

---

## 11. Phase 8：命令产品面瘦身与文档统一

**Objective:** 根据现有命令深度优化用户心智：核心命令突出、兼容/实验命令降级、风险命令不再鼓励误用。

**Files:**

- Modify: `src/commands/current.ts`
- Modify: `src/commands/new-chat.ts`
- Modify: `src/commands/hook.ts`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `docs/dev/roadmap.md`
- Modify: `docs/dev/iteration-plan.md`
- Test: CLI command docs tests if added

### Task 8.1：弱化 `handoff` alias

**Step 1: 保留 `handoff` 命令，但 help 文案标注 compatibility alias**

不要删除命令。

**Step 2: README 主路径只写 `new-chat`**

`handoff` 只放在 compatibility section。

**Step 3: 测试**

```bash
npx vitest run tests/cli-commands.test.ts -t "handoff|new-chat"
```

### Task 8.2：降级或移除 `current --compress`

推荐方案：从主文档移除，只作为 advanced/legacy 保留一版；若要删除，需先做 deprecation 版本。

**Step 1: 决策记录**

在 `docs/dev/iteration-plan.md` 记录：

- `current` 是 latest discovery，不是 current-window API。
- 压缩推荐路径是 `report` 后显式 `compress <file> -o`。

**Step 2: 若保留 flag，增强输出**

`current --compress` 必须输出被选择的 source path，避免用户误判。

**Step 3: 测试**

```bash
npx vitest run tests/cli-commands.test.ts -t "current compresses"
```

### Task 8.3：统一 Phase 0 / hooks / tokenizer 文档口径

必须修复：

- README/usage 与 roadmap/iteration-plan 对 hooks/install 状态的冲突。
- `new-chat` 文档漏掉实际生成 `README.md` 的问题。
- `docs/user/usage.md` 中“Analyze a file” 示例却写 `trimctx new-chat` 的不一致。
- Tokenizer 说明统一：默认 heuristic；可选 `js-tiktoken` 对 OpenAI/Codex-family 本地精确；Claude Code 不夸大。
- Codex 不宣称未验证 slash command。

**Step 1: 搜索 stale claims**

```bash
python3 - <<'PY'
from pathlib import Path
terms = [
  'resume <uid>', 'no Claude slash', 'no integration',
  'current-window', 'curl | bash', 'irm ', 'iex'
]
for p in list(Path('README.md').parent.glob('README*.md')) + list(Path('docs').rglob('*.md')) + list(Path('plugins').rglob('*.md')) + list(Path('codex').rglob('*.md')):
    text = p.read_text(encoding='utf-8', errors='replace')
    for t in terms:
        if t in text:
            print(p, t)
PY
```

**Step 2: 修改文档**

**Step 3: 包体测试**

```bash
npm test
npm run build
npm pack --dry-run --json
```

**Commit:**

```bash
git add README.md README_zh.md docs plugins codex tests
git commit -m "docs: align command surface and safety boundaries"
```

---

## 12. Phase 9：测试矩阵补强

**Objective:** 在完全重构后补齐薄弱覆盖，尤其 OpenAI parser、CLI 参数矩阵、package install、Phase 0 trust。

**Files:**

- Modify/Create: `tests/parser.openai-jsonl.test.ts`
- Modify/Create: `tests/cli-commands.test.ts`
- Modify/Create: `tests/compressor.test.ts`
- Modify/Create: `tests/package-contents.test.ts`
- Modify/Create: `tests/phase0-review.test.ts`
- Create fixtures under `tests/fixtures/` as sanitized data only

### Task 9.1：OpenAI parser fixture 扩充

补测试：

- `messages[]` 多消息 + sourceIndex 稳定
- tool calls / tool results
- developer/system roles
- empty content
- mixed content array
- malformed row 诊断
- unknown role normalize

运行：

```bash
npx vitest run tests/parser.openai-jsonl.test.ts tests/compressor.test.ts
npm run build
```

### Task 9.2：CLI 参数矩阵补强

覆盖：

- `--recent-window 0`
- 小数/负数/非数字拒绝
- `--remove-threshold 0/1/>1/<0/non-number`
- `--compress-threshold` 与 remove threshold 关系
- `--out/-o/--next-context` 互斥
- root/env/latest/no-session

运行：

```bash
npx vitest run tests/cli-commands.test.ts
```

### Task 9.3：压缩不变性矩阵

覆盖：

- input sha256 不变
- relative/absolute same file 拒绝
- symlink same file（如平台支持）
- protected 永不删除
- `compress_candidate` 永远保留
- skipped records 保留
- remove count 与 report count 一致

运行：

```bash
npx vitest run tests/compressor.test.ts tests/reporter.test.ts
```

### Task 9.4：Package / install smoke 增强

确认 packed tarball fresh install 后运行：

- `trimctx --version`
- `trimctx --help`
- `trimctx init --dry-run --target user`
- fixture analyze/report/compress/new-chat

运行：

```bash
npx vitest run tests/package-contents.test.ts
npm pack --dry-run --json
```

**Commit:**

```bash
git add tests
 git commit -m "test: expand refactor regression matrix"
```

---

## 13. Phase 10：Phase 0 验证流程收敛

**Objective:** 让项目是否可推荐“安全压缩”由真实指标决定，而非仅由单元测试通过决定。

**Files:**

- Modify: `scripts/phase0-run.ts`
- Modify: `scripts/phase0-review.ts`
- Create/Modify: `scripts/lib/*`（如拆内部脚本工具）
- Modify: `docs/dev/roadmap.md`
- Modify: `docs/dev/iteration-plan.md`
- Modify: `docs/user/usage*.md`
- Test: `tests/phase0-summary.test.ts`, `tests/phase0-review.test.ts`

### Task 10.1：scripts/lib 整理

可选拆出：

```text
scripts/lib/args.ts
scripts/lib/report-reader.ts
scripts/lib/markdown.ts
scripts/lib/command.ts
```

保持 `npm run phase0:run` 与 `npm run phase0:review` 命令不变。

### Task 10.2：人工 review rubric 固化

必须记录指标：

- `safe_remove`
- `questionable_remove`
- `critical_false_delete`
- `missed_low_value_noise`
- `over_protected`

Phase 0 完成条件：

- `critical_false_deletion = 0`
- `protected_recall = 100%`
- `remove_candidate_precision` 达到文档定义门槛
- 关键 protected 全量 + 非关键 protected 抽样覆盖

### Task 10.3：真实样本验证流程文档化

文档要求：

- 私有样本放在 gitignored 目录，如 `tmp-real-validation/`
- 输出放在 gitignored report 目录
- 公开 summary 只包含聚合指标
- 不提交 `phase0-results.json` 中的本机路径和错误片段

### Task 10.4：质量门

```bash
npx vitest run tests/phase0-summary.test.ts tests/phase0-review.test.ts
npm test
npm run build
npm pack --dry-run --json
```

**Commit:**

```bash
git add scripts tests docs
 git commit -m "test: harden phase0 trust validation workflow"
```

---

## 14. Phase 11：最终发布候选门禁

**Objective:** 完成全面重构后，以发布级证据证明项目可用、包体正确、文档一致、安全边界未破坏。

### Task 11.1：全量质量门

```bash
cd '/home/now/文档/work/trimContext'
npm test
npm run build
git diff --check
npm pack --dry-run --json
```

Expected:

- 全部通过
- `npm pack --dry-run --json` 不包含私有输出、源码、测试、真实 transcript

### Task 11.2：编译后 CLI smoke

```bash
npm run build:publish
node dist/cli.js --version
node dist/cli.js --help
node dist/cli.js analyze tests/fixtures/claude-code-realistic.jsonl
node dist/cli.js report tests/fixtures/codex-realistic.jsonl -o /tmp/trimctx-report.json
node dist/cli.js compress tests/fixtures/codex-realistic.jsonl -o /tmp/trimctx-out.jsonl
node dist/cli.js new-chat tests/fixtures/codex-realistic.jsonl --out /tmp/trimctx-handoff
```

验证：

```bash
test -f /tmp/trimctx-report.json
test -f /tmp/trimctx-out.jsonl
test -f /tmp/trimctx-handoff/manifest.json
```

### Task 11.3：packed tarball fresh install smoke

```bash
TMP=$(mktemp -d)
npm pack --pack-destination "$TMP" --json
npm install --global --prefix "$TMP/prefix" "$TMP"/*.tgz
"$TMP/prefix/bin/trimctx" --version
"$TMP/prefix/bin/trimctx" --help
"$TMP/prefix/bin/trimctx" init --dry-run --target user --dir "$TMP/home"
cd /
rm -rf "$TMP"
```

### Task 11.4：文档链接与 stale claims 扫描

```bash
python3 - <<'PY'
from pathlib import Path
bad = ['curl | bash', 'irm ', 'iwr ', ' | iex', 'resume <uid>']
for root in ['README.md','README_zh.md','docs','plugins','codex']:
    paths = [Path(root)] if Path(root).is_file() else list(Path(root).rglob('*.md'))
    for p in paths:
        text = p.read_text(encoding='utf-8', errors='replace')
        for term in bad:
            if term in text:
                print(f'{p}: {term}')
PY
```

### Task 11.5：最终 git 状态

```bash
git status --short --branch --untracked-files=all
```

Expected:

- 除预期源代码/测试/文档改动外，无私有输出。
- 提交后工作区干净。

**Commit:**

```bash
git add src tests scripts README.md README_zh.md docs plugins codex package.json package-lock.json
git commit -m "refactor: restructure trimctx command and analysis architecture"
```

---

## 15. 风险与回滚策略

### 15.1 高风险区域

1. Commander root action 与 subcommand 交互。
2. `trimctx init` 的 interactive/non-interactive 行为。
3. `install-hooks` merge `.claude/settings.json`。
4. `new-chat` default package 与 legacy `-o --next-context` 双模式。
5. OpenAI `messages[]` 行内压缩索引。
6. Codex skipped records 保留。
7. `sourceLine/sourceIndex/id` 稳定性。
8. `build:publish` bundled CLI 与源码路径定位。

### 15.2 回滚策略

- 每个 phase 单独 commit。
- 若某阶段测试大面积失败，先 `git status --short` 看改动范围。
- 优先回滚该阶段 commit 或局部文件，不在坏状态上继续叠加重构。
- 子代理如超时或留下半成品，父代理必须先恢复干净再继续。

---

## 16. 可并行执行建议

适合并行只读/小范围实现：

- OpenAI parser 测试补强。
- 文档 stale claims 扫描与修复建议。
- package install smoke 测试增强。
- Phase0 review 测试补强。

不适合并行编辑：

- `src/cli.ts` 拆分初期。
- `src/core/analyzer.ts` 与 adapter registry 改造。
- `src/core/compressor.ts` 与 adapter compression 改造。
- reason metadata 统一。

---

## 17. 完成定义

本长任务计划完成后，必须满足：

1. `src/cli.ts` 不再承担所有职责，命令模块清晰。
2. 文件安全、参数解析、presentation formatter、reason labels 无重复实现。
3. session discovery 与 analysis pipeline 解耦。
4. adapter registry 负责格式探测，格式特定 compression 下沉到 adapter。
5. `Reason` 的 hard protect、discount、label 语义集中定义。
6. reporter 被拆分，report schema v1 兼容保留。
7. hooks/install 侧效应明确，默认不制造隐式项目文件修改或至少文档完全披露。
8. README、usage、roadmap、iteration-plan 与真实能力一致。
9. 测试矩阵覆盖 CLI、parser、compressor、package、Phase0 trust。
10. 全量质量门通过：

```bash
npm test
npm run build
git diff --check
npm pack --dry-run --json
```

11. compiled CLI 与 packed tarball fresh install smoke 通过。
12. 没有私有 transcript、真实 report、tmp validation 输出进入 git 或 npm package。

---

## 18. 推荐立即执行顺序

如果下一步开始实现，建议按下面顺序推进，不要跳阶段：

1. Phase 0：提交 refactor baseline 文档。
2. Phase 1：抽共享工具，移除低风险重复。
3. Phase 2：拆 CLI 命令模块。
4. Phase 3：拆 session/pipeline。
5. Phase 4：adapter registry + compression adapter 化。
6. Phase 5：reason metadata 统一。
7. Phase 6：reporter 分包。
8. Phase 7：integrations 拆分与 hook 副作用决策。
9. Phase 8：命令产品面和文档统一。
10. Phase 9-11：测试补强、Phase0、发布候选门禁。

每完成一个 phase：运行质量门、提交一次、再进入下一 phase。
