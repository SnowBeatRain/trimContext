# trimctx Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变评分、阈值、Report v2 和六命令公开面的前提下，关闭已确认的压缩误删、摘要泄密、hook 劫持/并发覆盖/资源耗尽及安装脚本目录误删风险。

**Architecture:** 在压缩写入前增加消息身份唯一性安全门，并用一个纯函数模块统一所有持久化摘要的脱敏。Claude hook 安装显式注入由绝对 Node 与 CLI 路径生成的命令，settings 复用现有 CAS 原子写；自动 hook 在进入解析和评分前执行字节数、文件类型和消息数限制。安装脚本只在 checkout origin 或插件 marker/旧版指纹能证明所有权后执行更新与替换。

**Tech Stack:** Node.js 20+、TypeScript、commander、Vitest、PowerShell、POSIX shell

---

本计划在当前工作树内 inline 执行，不创建 git commit，不修改原始 transcript，不调整 scorer、threshold、protected 或 candidate 规则。

### Task 1: 重复消息 ID 压缩安全门

**Files:**
- Create: `src/core/message-identity.ts`
- Create: `tests/message-identity.test.ts`
- Modify: `src/core/compressor.ts`
- Modify: `tests/compressor-output-failure.test.ts`

- [x] **Step 1: 写唯一性校验和压缩副作用的失败测试**

```ts
test("reports only the duplicate ID count without echoing content", () => {
  expect(() => assertUniqueMessageIds([
    message("duplicate", "first-private-body", 1),
    message("duplicate", "second-private-body", 2)
  ])).toThrow("Cannot compress transcript with 1 duplicate message ID");
});

test("rejects duplicate IDs before creating or replacing compressed output", async () => {
  // 旧 duplicate 是 remove_candidate，recent window 中同 ID 消息是 keep_protected。
  const duplicateClaudeTranscript = [
    '{"type":"assistant","uuid":"duplicate","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"assistant","uuid":"old-2","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    ...Array.from({ length: 35 }, (_, index) => JSON.stringify({
      type: index % 2 === 0 ? "user" : "assistant",
      uuid: `pad-${index}`,
      message: { role: index % 2 === 0 ? "user" : "assistant", content: `padding ${index}` }
    })),
    '{"type":"user","uuid":"duplicate","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}'
  ].join("\n");
  const existingOutput = "existing compressed copy\n";
  await writeFile(input, duplicateClaudeTranscript, "utf8");
  await writeFile(output, existingOutput, "utf8");
  await expect(compressFile(input, output)).rejects.toThrow(
    "Cannot compress transcript with 1 duplicate message ID"
  );
  expect(await readFile(input, "utf8")).toBe(duplicateClaudeTranscript);
  expect(await readFile(output, "utf8")).toBe(existingOutput);
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/message-identity.test.ts tests/compressor-output-failure.test.ts`

Expected: FAIL；`assertUniqueMessageIds` 尚不存在，且当前 `compressFile()` 会按 ID 集合误删或覆盖输出。

- [x] **Step 3: 实现固定计数的唯一性安全门并接入压缩器**

```ts
// src/core/message-identity.ts
import type { NormalizedMessage } from "../types/message.js";

export function assertUniqueMessageIds(messages: readonly NormalizedMessage[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) duplicates.add(message.id);
    seen.add(message.id);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Cannot compress transcript with ${duplicates.size} duplicate message ID${duplicates.size === 1 ? "" : "s"}`
    );
  }
}
```

在 `compressFile()` 的 `analyzeMessages()` 之后、`createReport()` 和 `removeIds` 构造之前调用 `assertUniqueMessageIds(analyzed)`；公共 `analyze`/`report` 不调用该安全门。

- [x] **Step 4: 运行聚焦回归并确认 GREEN**

Run: `npx vitest run tests/message-identity.test.ts tests/compressor.test.ts tests/compressor-output-failure.test.ts tests/cli-analyze.test.ts`

Expected: PASS；重复 ID 压缩失败且输入与既有输出逐字节不变，普通分析仍能生成报告。

### Task 2: 共享摘要脱敏

**Files:**
- Create: `src/core/redaction.ts`
- Create: `tests/redaction.test.ts`
- Modify: `src/core/report-review.ts`
- Modify: `src/core/report-markdown.ts`
- Modify: `src/core/resume/extractor.ts`
- Modify: `src/core/context-state.ts`
- Modify: `tests/report-construction-boundaries.test.ts`
- Modify: `tests/report-markdown.test.ts`
- Modify: `tests/tokenizer-resume.test.ts`
- Modify: `tests/context-state.test.ts`

- [x] **Step 1: 写标准 GitHub token 和既有凭据族的失败测试**

```ts
const secretText = [
  "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
  "github_pat_11AA0_exampleABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "Authorization: Bearer opaque-token",
  "Authorization: Basic dXNlcjpwYXNz",
  "https://user:password@example.com/private",
  "owner@example.com",
  "api_key=private-value"
].join(" ");

expect(redactSensitiveText(secretText)).not.toMatch(/ghp_|github_pat_|opaque-token|dXNlcjpwYXNz|user:password|owner@example\.com|private-value/);
```

分别把 `ghp_...` 和 `github_pat_...` 放入 review queue summary、resume goal、Markdown 显示文本和 CLAUDE.md goal，断言产物只含 `[REDACTED]` / `[REDACTED_EMAIL]`。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/redaction.test.ts tests/report-construction-boundaries.test.ts tests/report-markdown.test.ts tests/tokenizer-resume.test.ts tests/context-state.test.ts`

Expected: FAIL；当前正则要求 `ghp-` / `github_pat-`，标准下划线 token 会泄漏。

- [x] **Step 3: 新增共享纯文本脱敏并替换四处私有实现**

```ts
// src/core/redaction.ts
export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\b(?:sk|pk|glpat|xox[baprs])[-_][-A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]+/gi, "Authorization: Basic [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;|]+/gi, "$1=[REDACTED]");
}
```

`report-review.ts`、`report-markdown.ts`、`resume/extractor.ts` 和 `context-state.ts` 导入该函数；保留各自的空白折叠、长度限制、Markdown 转义和 trimctx marker 中和顺序。

- [x] **Step 4: 运行聚焦回归并确认 GREEN**

Run: `npx vitest run tests/redaction.test.ts tests/report-construction-boundaries.test.ts tests/report-markdown.test.ts tests/tokenizer-resume.test.ts tests/context-state.test.ts`

Expected: PASS；完整 JSON report、`export` 与 `new-chat` 契约没有改动。

### Task 3: settings 条件写入与绝对 hook 命令

**Files:**
- Create: `src/commands/hook-command.ts`
- Create: `tests/hook-command.test.ts`
- Modify: `src/commands/hook-settings.ts`
- Modify: `src/commands/hook-installer.ts`
- Modify: `src/commands/init.ts`
- Modify: `tests/hook-settings.test.ts`
- Modify: `tests/hook-installer.test.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: 写命令注入、平台引用和并发覆盖失败测试**

```ts
const commands = {
  sessionStart: "ABSOLUTE_NODE ABSOLUTE_CLI hook --session-start",
  stop: "ABSOLUTE_NODE ABSOLUTE_CLI hook"
};
expect(planHookSettings({}, commands)).toMatchObject({
  status: "write",
  settings: { hooks: {
    SessionStart: [{ hooks: [{ command: commands.sessionStart }] }],
    Stop: [{ hooks: [{ command: commands.stop }] }]
  } }
});
```

真实 `init --with-hooks` 测试根据 `process.execPath` 与 `join(projectRoot, "dist", "cli.js")` 断言 command，不再包含裸 `trimctx hook`。另在 settings 读取后注入外部写入，断言 `installHooks()` 抛出 `Claude settings changed while hooks were being prepared` 且外部字节保留。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/hook-command.test.ts tests/hook-settings.test.ts tests/hook-installer.test.ts tests/hook.test.ts`

Expected: FAIL；planner 仍使用常量裸命令，installer 仍无条件 `atomicWriteFile()`。

- [x] **Step 3: 生成可安全引用的绝对命令**

```ts
export interface HookCommands {
  sessionStart: string;
  stop: string;
}

export function createHookCommands(
  packageRoot: string,
  platform: NodeJS.Platform = process.platform,
  nodePath = process.execPath
): HookCommands {
  const cliPath = join(packageRoot, "dist", "cli.js");
  const quote = platform === "win32" ? quoteWindowsArgument : quotePosixArgument;
  const stop = `${quote(nodePath)} ${quote(cliPath)} hook`;
  return { stop, sessionStart: `${stop} --session-start` };
}
```

POSIX 使用单引号并把 `'` 编码为 `'\\''`；Windows 使用双引号，拒绝控制字符、双引号、`%` 和 `!`。两者遇到不安全路径都抛出 `Cannot safely quote Claude hook command path`。

- [x] **Step 4: 将命令显式传入 planner，并用 CAS 持久化原始快照**

```ts
export function planHookSettings(
  input: unknown,
  commands: HookCommands,
  options: { force?: boolean } = {}
): HookSettingsPlan {
  const settings = requiredObject(input, "Claude settings");
  const hooks = settings.hooks === undefined
    ? {}
    : requiredObject(settings.hooks, "Claude settings hooks");
  const sessionStartHooks = eventGroups(hooks, "SessionStart");
  const stopHooks = eventGroups(hooks, "Stop");
  const hasSessionStart = containsHook(sessionStartHooks, commands.sessionStart);
  const hasStop = containsHook(stopHooks, commands.stop);
  if (hasSessionStart && hasStop && !options.force) return { status: "already_installed" };

  const nextSessionStart = options.force
    ? removeHookEntries(sessionStartHooks, commands.sessionStart)
    : [...sessionStartHooks];
  const nextStop = options.force
    ? removeHookEntries(stopHooks, commands.stop)
    : [...stopHooks];
  if (!hasSessionStart || options.force) nextSessionStart.push(trimctxHookGroup(commands.sessionStart));
  if (!hasStop || options.force) nextStop.push(trimctxHookGroup(commands.stop));
  return {
    status: "write",
    settings: {
      ...settings,
      hooks: { ...hooks, SessionStart: nextSessionStart, Stop: nextStop }
    }
  };
}

interface HookSettingsSnapshot {
  settings: unknown;
  bytes: Buffer | undefined;
}

await atomicWriteFileIfUnchanged(
  settingsPath,
  output,
  snapshot.bytes,
  "Claude settings changed while hooks were being prepared"
);
```

`init.ts` 仅在 `--with-hooks` 生效时调用 `createHookCommands(packageRoot)`，并把同一 commands 对象用于 dry-run preflight 与实际写入。

- [x] **Step 5: 运行聚焦回归并确认 GREEN**

Run: `npx vitest run tests/hook-command.test.ts tests/hook-settings.test.ts tests/hook-installer.test.ts tests/hook.test.ts tests/init-boundaries.test.ts`

Expected: PASS；`--force` 只替换当前绝对命令的精确匹配项，用户 hook 保留，并发变化 fail closed。

### Task 4: 自动 hook 资源限制

**Files:**
- Modify: `src/core/hook-input.ts`
- Modify: `src/core/hook-analysis.ts`
- Modify: `tests/hook-input.test.ts`
- Modify: `tests/hook-analysis.test.ts`
- Modify: `tests/hook.test.ts`

- [x] **Step 1: 写 stdin、transcript 字节数和消息数失败测试**

```ts
await expect(readHookInput(Readable.from([
  Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1, "a")
]))).rejects.toThrow("Claude hook input exceeds 1048576 bytes");

await truncate(transcript, MAX_HOOK_TRANSCRIPT_BYTES + 1);
await expect(analyzeClaudeStopFile(transcript)).rejects.toThrow(
  "Claude Stop transcript exceeds 67108864 bytes"
);

await writeFile(transcript, tenThousandAndOneClaudeMessages, "utf8");
await expect(analyzeClaudeStopFile(transcript)).rejects.toThrow(
  "Claude Stop transcript exceeds 10000 normalized messages"
);
```

CLI 子进程测试同时断言超限时不会创建 `CLAUDE_ENV_FILE` 或项目 `.claude/CLAUDE.md`，transcript hash 不变，stderr 不含输入正文。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/hook-input.test.ts tests/hook-analysis.test.ts tests/hook.test.ts`

Expected: FAIL；当前 hook 会无界读取 stdin/transcript 并继续分析。

- [x] **Step 3: 在解析/评分前实现固定资源门**

```ts
export const MAX_HOOK_INPUT_BYTES = 1024 * 1024;
export const MAX_HOOK_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
export const MAX_HOOK_TRANSCRIPT_MESSAGES = 10_000;
```

`readHookInput()` 累加 chunk 字节数，一旦超过 1 MiB 就销毁可销毁流并抛固定错误。`analyzeClaudeStopFile()` 用同一只读 file handle：先 `stat()` 并要求普通文件及大小不超限，再 `readFile()` 到 Buffer 并复查 `byteLength`；解析、补入 `last_assistant_message` 后，在 `analyzeMessages()` 之前检查消息数。

- [x] **Step 4: 运行聚焦回归并确认 GREEN**

Run: `npx vitest run tests/hook-input.test.ts tests/hook-analysis.test.ts tests/hook.test.ts tests/hook-storage.test.ts`

Expected: PASS；正常 hook 行为不变，超限路径无持久化副作用。

### Task 5: GitHub 安装脚本目录所有权

**Files:**
- Create: `plugins/trimctx/.trimctx-install-marker`
- Create: `tests/install-scripts.test.ts`
- Modify: `install.ps1`
- Modify: `install.sh`
- Modify: `tests/package-contents.test.ts`

- [x] **Step 1: 写受控临时目录行为测试**

```ts
test("the platform installer rejects an unknown checkout without deleting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "trimctx-script-ownership-"));
  const installDir = join(root, "unknown-checkout");
  const pluginDir = join(root, "plugin");
  const binDir = join(root, "bin");
  const sentinel = join(installDir, "sentinel.txt");
  await mkdir(installDir, { recursive: true });
  await writeFile(sentinel, "user-owned", "utf8");

  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-File", join(process.cwd(), "install.ps1"),
      "-InstallDir", installDir, "-BinDir", binDir, "-ClaudePluginDir", pluginDir]
    : [join(process.cwd(), "install.sh")];
  const env = process.platform === "win32" ? process.env : {
    ...process.env,
    TRIMCTX_INSTALL_DIR: installDir,
    TRIMCTX_BIN_DIR: binDir,
    TRIMCTX_CLAUDE_PLUGIN_DIR: pluginDir
  };

  const result = await execFileResult(command, args, { env });
  expect(result.code).not.toBe(0);
  expect(await readFile(sentinel, "utf8")).toBe("user-owned");
});

async function execFileResult(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv }
): Promise<{ code: number; stderr: string }> {
  try {
    await execFileAsync(command, args, options);
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { code: failure.code ?? 1, stderr: failure.stderr ?? "" };
  }
}
```

在同一测试文件按上述完整子进程模式覆盖：未知非 git checkout、origin 不匹配、未知同名插件目录、有效 marker、旧版最小结构迁移、根目录/用户主目录拒绝。会进入成功安装路径的用例在临时 `PATH` 中写入确定性的 fake `git`/`npm`/`node` 可执行文件：fake git 返回临时 checkout 的 top-level 与指定 origin，fetch/checkout 成功；fake npm 成功；fake node 对 `--version` 返回 `v20.0.0` 并对最终 smoke 返回 0。Windows 执行 `install.ps1`，POSIX 执行 `install.sh`。

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/install-scripts.test.ts tests/package-contents.test.ts`

Expected: FAIL；PowerShell 会删除未知 checkout，两套脚本都会无条件递归删除插件目录，marker 尚未发布。

- [x] **Step 3: 在任何写入前完成安全目标与所有权预检**

PowerShell 和 shell 均实现以下顺序：

```text
resolve and reject empty/root/home targets
inspect existing checkout -> require exact top-level git checkout -> require origin == RepoUrl
inspect existing plugin -> require exact marker OR legacy fingerprint
only then create parents, clone/fetch/build, create shims, replace owned plugin
verify installed marker content == "trimctx-plugin-v1"
```

marker 的固定内容为：

```text
trimctx-plugin-v1
```

旧版最小结构指纹必须同时存在：`.claude-plugin/plugin.json`、`.system`、`commands/trimctx.md`。PowerShell 对 reparse point fail closed；两套脚本对所有检查失败只报目标/类别，不递归删除目标。

- [x] **Step 4: 运行安装脚本与 package 回归并确认 GREEN**

Run: `npx vitest run tests/install-scripts.test.ts tests/package-contents.test.ts`

Expected: PASS；tarball 包含 marker，未知目录内容保留，合法旧安装可迁移。

### Task 6: Phase 0 竞态断言稳定化

**Files:**
- Modify: `tests/phase0-run-safety.test.ts`
- Modify: `tests/phase0-run-sample.test.ts`

- [x] **Step 1: 用可注入 runner 确定性覆盖缺失压缩产物**

```ts
const report = minimumReport(samplePlan.inputFile);
const runCli: Phase0CliRunner = async (args) => {
  if (args[0] === "analyze") {
    return { ok: true, exit_code: 0, stdout: JSON.stringify(report) };
  }
  if (args[0] === "report") {
    await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
  }
  // compress 返回成功，但故意不创建 compressedFile。
  return { ok: true, exit_code: 0 };
};

const result = await validatePhase0Sample(samplePlan, 1_000, runCli);
expect(result).toMatchObject({
  input_unchanged: true,
  source: "openai-jsonl",
  compress: { ok: false, exit_code: 0 }
});
expect(result.compress.error).toBe(
  `Compressed artifact was not created: ${samplePlan.compressedFile}`
);
expect(isPhase0SampleOk(result)).toBe(false);
```

删除 `phase0-run-safety` 中用 5ms 轮询删除产物的时序敏感用例；它可能在产物已经完成读取、结构校验和哈希后才删除文件，此时成功结果是合法的，不能用于断言缺失产物分支。保留批次安全测试对 report 失败聚合、input hash 和最终工件事务的覆盖。

- [x] **Step 2: 重复运行稳定性测试**

Run: `1..5 | ForEach-Object { npx vitest run tests/phase0-run-safety.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`

Expected: PASS；测试结果不再依赖跨进程轮询能否抢在压缩产物校验前完成。

### Task 7: 文档同步

**Files:**
- Modify: `docs/user/usage.md`
- Modify: `docs/user/usage_zh.md`
- Modify: `plugins/trimctx/README.md`
- Modify: `README.md`
- Modify: `README_zh.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: 更新安全边界说明**

文档明确以下事实：hook settings 使用安装时确定的绝对 Node/CLI 路径；SessionStart 只追加 `CLAUDE_ENV_FILE` 绑定；Stop 只读 transcript、可能只更新 `.claude/CLAUDE.md` 的 trimctx 受管区块；hook 输入为 1 MiB、Stop transcript 为 64 MiB/10,000 messages；显式 CLI 不受本轮 hook 限制；安装脚本只替换 marker 或旧版指纹确认的目录；重复 message ID 时 `compress` 拒绝写入。

- [x] **Step 2: 运行文档和打包契约测试**

Run: `npx vitest run tests/package-contents.test.ts tests/cli-surface.test.ts`

Expected: PASS；六个公开命令和 Claude/Codex 资产契约保持不变。

### Task 8: 全量质量门与差异审查

**Files:**
- Verify only: all changed files

- [x] **Step 1: 运行全部测试与构建**

Run: `npm test`

Expected: PASS，0 failed。

Run: `npm run build`

Expected: PASS，TypeScript 0 errors。

- [x] **Step 2: 运行发布与依赖质量门**

Run: `npx vitest run tests/package-contents.test.ts`

Expected: PASS，包括 packed tarball fresh-install smoke 和六命令帮助面。

Run: `npm audit --omit=dev --json`

Expected: exit 0，生产依赖漏洞总数为 0。

- [x] **Step 3: 检查补丁完整性与工作树**

Run: `git diff --check`

Expected: 无输出，exit 0。

Run: `git status --short`

Expected: 只列出本安全加固计划、设计、代码、测试、marker 和文档变更；不存在真实样本报告、压缩副本、tarball 或临时目录。

- [x] **Step 4: 对照设计逐项复核**

确认压缩 fail closed、共享脱敏、绝对 hook command、checkout/plugin 所有权、settings CAS、hook 三项资源限制和 Phase 0 竞态断言均有 RED/GREEN 证据；确认 scorer、threshold、Report v2、公开六命令、完整 export/JSON/new-chat 契约及原 transcript 只读行为未变。
