# Current Session Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `current` 严格分析当前窗口绑定，并为裸命令及 `analyze --select/--latest` 提供本地会话选择能力。

**Architecture:** 绑定解析与文件发现放在 `src/sessions/discovery.ts`，交互逻辑放在新建的 `src/sessions/picker.ts`，`src/commands/analysis.ts` 只处理参数契约和调用现有分析管线。`new-chat` 继续使用兼容 resolver。

**Tech Stack:** Node.js 20、TypeScript、Commander、`node:readline/promises`、Vitest

---

### Task 1: 严格绑定与轻量发现

**Files:**
- Modify: `src/sessions/discovery.ts`
- Modify: `tests/session-boundaries.test.ts`

- [ ] **Step 1: 写失败测试**

增加临时 HOME 下 Claude/Codex 文件，断言 `listSessions("auto")` 返回按 mtime 降序的来源、标签、大小和文件名 session ID；断言 `resolveBoundSessionFile()` 在无绑定、非文件、不可读和 `TRIMCTX_SESSION_ID` 不匹配时失败。

- [ ] **Step 2: 确认 RED**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: FAIL，`listSessions` / `resolveBoundSessionFile` 尚未导出。

- [ ] **Step 3: 最小实现**

增加以下接口并复用当前递归扫描逻辑：

```ts
export interface SessionCandidate {
  source: "claude" | "codex";
  projectLabel: string;
  modifiedAt: Date;
  mtimeMs: number;
  sizeBytes: number;
  sessionId: string;
  file: string;
}

export async function listSessions(source?: SessionSource): Promise<SessionCandidate[]>;
export async function resolveBoundSessionFile(): Promise<string>;
export function hasCurrentSessionBinding(): boolean;
```

严格 resolver 使用 `access(R_OK)`、`stat().isFile()` 和文件名 ID 校验。保留 `resolveCurrentSessionFile()` fallback。

- [ ] **Step 4: 确认 GREEN**

Run: `npx vitest run tests/session-boundaries.test.ts`

Expected: PASS。

### Task 2: 选择器

**Files:**
- Create: `src/sessions/picker.ts`
- Create: `tests/session-picker.test.ts`

- [ ] **Step 1: 写失败测试**

用注入的 `write` / `ask` adapter 断言空输入选择第一项、`"2"` 选择第二项、输出包含来源和“不恢复或切换”说明，越界及非整数抛出明确错误。

- [ ] **Step 2: 确认 RED**

Run: `npx vitest run tests/session-picker.test.ts`

Expected: FAIL，picker 模块不存在。

- [ ] **Step 3: 最小实现**

实现：

```ts
export function isInteractiveTerminal(): boolean;
export function formatSessionCandidate(candidate: SessionCandidate, now?: Date): string;
export async function selectSession(
  candidates: SessionCandidate[],
  adapter?: { write(text: string): void; ask(prompt: string): Promise<string> }
): Promise<SessionCandidate>;
```

默认 adapter 用 `node:readline/promises` 读 stdin、写 stderr；只询问一次，最多接收调用方提供的 20 项。

- [ ] **Step 4: 确认 GREEN**

Run: `npx vitest run tests/session-picker.test.ts`

Expected: PASS。

### Task 3: 命令契约

**Files:**
- Modify: `src/commands/analysis.ts`
- Modify: `tests/cli-commands.test.ts`

- [ ] **Step 1: 写 CLI 失败测试**

将旧 current/latest 测试替换为：`current --json` 只接受绑定且无绑定不 fallback；`analyze --latest --source claude|codex`；交互 `analyze --select`；交互裸命令；非交互裸命令失败。补 file/select/latest/source 冲突测试，并断言 current help 不含旧参数。

- [ ] **Step 2: 确认 RED**

Run: `npx vitest run tests/cli-commands.test.ts`

Expected: FAIL，旧 current 仍扫描且新参数未注册。

- [ ] **Step 3: 最小实现**

在 `src/commands/analysis.ts` 注册 `--select`、`--latest`、`--source`，先校验冲突，再按 explicit file、select、latest、bound 顺序解析。`current` 调严格 resolver；裸命令无绑定时仅在交互环境打开 picker。picker 仅接收最近 20 项。

- [ ] **Step 4: 确认 GREEN 与回归**

Run: `npx vitest run tests/cli-commands.test.ts tests/session-boundaries.test.ts tests/session-picker.test.ts tests/analysis-options.test.ts tests/hook.test.ts`

Expected: PASS，`new-chat` latest fallback 保持不变。

### Task 4: 文档与客户端资产

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `docs/dev/roadmap.md`
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `plugins/trimctx/commands/trimctx/analyze.md`
- Modify: `codex/skills/trimctx/SKILL.md`
- Modify: `tests/package-contents.test.ts`

- [ ] **Step 1: 写资产失败断言**

断言打包的 Claude/Codex Markdown 不再推荐 `current --source codex`，并包含 `analyze --latest --source codex` 或严格当前绑定说明。

- [ ] **Step 2: 确认 RED**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: FAIL，资产仍描述旧 current 语义。

- [ ] **Step 3: 更新文档**

统一示例：

```text
trimctx current                         # hooks 绑定的当前窗口
trimctx                                 # 当前绑定或交互选择
trimctx analyze --select                # 强制本地选择
trimctx analyze --latest --source codex # 最近 Codex 会话
```

明确 picker 不执行 `/resume`、不切换窗口、原 transcript 只读。

- [ ] **Step 4: 确认 GREEN**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: PASS。

### Task 5: 质量门

**Files:**
- Modify only if a regression is found in files listed above.

- [ ] **Step 1: 全量测试**

Run: `npm test`

Expected: 全部 PASS。

- [ ] **Step 2: 构建**

Run: `npm run build`

Expected: 退出码 0，无 TypeScript 错误。

- [ ] **Step 3: 补丁检查**

Run: `git diff --check`

Expected: 无 whitespace 错误。

- [ ] **Step 4: 包内容检查**

Run: `npm pack --dry-run --json`

Expected: 退出码 0，所需 CLI/插件/skill/文档存在，不含私有 transcript。
