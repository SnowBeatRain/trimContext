# Init Hook Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止 `init --with-hooks` 因可预测的 Claude settings 错误在命令失败前留下已安装或已替换的客户端资产。

**Architecture:** `init` facade 先通过现有 `installHooks(..., dryRun: true)` 完成无副作用 settings 预检，再调用资产 installer；真实安装最后重新读取并原子写 hooks，dry-run 复用预检行。两个 installer 的独立职责和 API 不变。

**Tech Stack:** Node.js 20+、TypeScript、Commander、Vitest、现有 init/hook installer

---

### Task 1: 用进程回归锁定半安装

**Files:**
- Modify: `tests/hook.test.ts`

- [x] **Step 1: 扩展无效 settings 用例**

在现有 `init --with-hooks rejects invalid settings without overwriting them` 用例中增加：

```ts
const pluginFile = join(dir, ".claude", "plugins", "trimctx", "commands", "trimctx.md");
expect(await fileExists(pluginFile)).toBe(false);
```

- [x] **Step 2: 增加 all-client 无副作用用例**

用无效 settings 执行 `init --client all --with-hooks`，断言 Claude plugin 与 Codex skill 的入口文件均不存在，settings 原文不变，stderr 不回显原文。

- [x] **Step 3: 运行测试确认 RED**

Run: `npx vitest run tests/hook.test.ts`

Expected: 两个新断言看到资产已存在并失败；既有 settings 不变断言仍通过。

### Task 2: 在 init facade 前置 hook 预检

**Files:**
- Modify: `src/commands/init.ts`

- [x] **Step 1: 保存无副作用 hook 预检结果**

在 `installInitAssets()` 前计算：

```ts
const hookPreflightLines = shouldInstallHooks
  ? await installHooks(settingsPath, { force: options.force, dryRun: true })
  : undefined;
```

settingsPath 仍为 `<baseDir>/.claude/settings.json`。

- [x] **Step 2: 保持写入顺序和 dry-run 输出**

资产 installer 完成后：

```ts
const hookLines = options.dryRun
  ? hookPreflightLines!
  : await installHooks(settingsPath, { force: options.force });
```

继续使用既有 `- ` 前缀和输出顺序。未请求 hooks/仅 Codex 的分支不变。

- [x] **Step 3: 运行 hook/init 聚焦测试确认 GREEN**

Run: `npx vitest run tests/hook.test.ts tests/hook-installer.test.ts tests/hook-settings.test.ts tests/init-boundaries.test.ts tests/cli-commands.test.ts`

Expected: 新增无副作用断言与所有既有成功、force、dry-run、隐私和命令测试通过。

### Task 3: 同步状态与质量门

**Files:**
- Modify: `docs/dev/status-and-next-steps.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 记录跨步骤预检边界**

说明无效/不可读 hook settings 会在任何资产写入前失败；实际 hook 写入仍重新读取并保持原子写。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 0 failures。

Run: `npm run build`

Expected: exit 0。

Run: `npx vitest run tests/package-contents.test.ts`

Expected: packed-install/fresh-install smoke 通过。

- [x] **Step 3: 运行发布与卫生检查**

Run: `npm pack --dry-run --json --silent`

Expected: 22 个发布文件。

Run: `git diff --check`

Expected: 无 whitespace errors，仅允许既有 LF -> CRLF 提示；无 `.tgz`、私有 Phase 0 工件或 `.vscode` 修改。
