## 1. Transcript Markdown 核心

- [x] 1.1 [CAP:conversation-transcript-export] 新建 `tests/transcript-markdown.test.ts`，先覆盖完整消息顺序、全部角色、可选审计元数据、空正文、无筛选、确定性和动态围栏安全。
- [x] 1.2 [CAP:conversation-transcript-export] 运行 `npx vitest run tests/transcript-markdown.test.ts`，确认因 `src/core/transcript-markdown.ts` 不存在而 RED。
- [x] 1.3 [CAP:conversation-transcript-export] 新建 `src/core/transcript-markdown.ts`，实现 `trimctx.transcript.v1` 事件账本、隐私/归一化说明、安全 code span 和动态正文围栏。
- [x] 1.4 [CAP:conversation-transcript-export] 再次运行聚焦测试并确认 GREEN。

## 2. CLI 命令与文件安全

- [x] 2.1 [CAP:conversation-transcript-export] 新建 `tests/cli-transcript.test.ts`，先覆盖三种 sanitized fixture、严格当前绑定、`.md` 限制、输入 hash、同路径、无效 JSONL 保留目标、无正文 stdout 和重复确定性。
- [x] 2.2 [CAP:conversation-transcript-export] 运行 `npx vitest run tests/cli-transcript.test.ts`，确认因 `transcript` 命令缺失而 RED。
- [x] 2.3 [CAP:conversation-transcript-export] 新建 `src/commands/transcript.ts` 并修改 `src/commands/index.ts`，实现 hash、`parseJsonl`、严格绑定、原子写入和简短完成摘要。
- [x] 2.4 [CAP:conversation-transcript-export] 运行 `npx vitest run tests/transcript-markdown.test.ts tests/cli-transcript.test.ts tests/platform-files.test.ts tests/file-safety.test.ts` 并确认 GREEN。

## 3. 公开命令面与客户端资产

- [x] 3.1 [CAP:cli-command-surface] 修改 `tests/cli-surface.test.ts` 与 `tests/cli-commands.test.ts`，先断言六个公开命令和 transcript 专用 help 契约。
- [x] 3.2 [CAP:conversation-transcript-integration] 修改 `tests/package-contents.test.ts`，先断言 Claude transcript asset、Codex 用法、安装后 help 和实际 packed transcript smoke。
- [x] 3.3 [CAP:cli-command-surface] 运行 `npx vitest run tests/cli-surface.test.ts tests/cli-commands.test.ts`，确认旧五命令断言 RED。
- [x] 3.4 [CAP:conversation-transcript-integration] 新建 `plugins/trimctx/commands/trimctx/transcript.md`，更新 plugin README、`.system` 与 `codex/skills/trimctx/SKILL.md`。
- [x] 3.5 [CAP:conversation-transcript-integration] 运行 `npx vitest run tests/cli-surface.test.ts tests/cli-commands.test.ts tests/package-contents.test.ts` 并确认 GREEN。

## 4. 用户、开发与发布文档

- [x] 4.1 [CAP:conversation-transcript-integration] 更新 `README.md`、`README_zh.md`、`docs/user/usage.md`、`docs/user/usage_zh.md`，说明命令、当前绑定、完整规范化范围和未脱敏风险。
- [x] 4.2 [CAP:cli-command-surface] 更新 `AGENTS.md`、`docs/dev/requirements.md`、`docs/dev/iteration-plan.md`、`docs/dev/roadmap.md`、`docs/dev/execution-plan.md`、`docs/dev/status-and-next-steps.md`，把此次经批准的例外和六命令合同写入主线。
- [x] 4.3 [CAP:conversation-transcript-integration] 更新 `CHANGELOG.md` 的 `Unreleased`，不提前修改 package version。
- [x] 4.4 [CAP:cli-command-surface] 使用 `rg` 检查残留“五个公开命令”和遗漏的 transcript 文档入口，区分历史版本记录与当前合同。

## 5. 发布级验证

以下项目须在第 6 节命令重命名完成后重新采集 fresh evidence。

- [x] 5.1 运行 export、parser、CLI surface、CLI commands 和 package contents 聚焦测试。
- [x] 5.2 运行 `npm test` 并确认全部测试通过。
- [x] 5.3 运行 `npm run build` 与 `npm run build:publish` 并确认 TypeScript 和发布 bundle 成功。
- [x] 5.4 运行 `npm pack --dry-run --json`，检查 bundle、Claude export asset、Codex skill 和文档，确认不含私有 transcript 或生成报告。
- [x] 5.5 对真实 Claude JSONL 运行 `export`，输出到 `tmp-real-validation/`，核对输入 SHA-256 未变、消息数与 parser 一致、首尾事件和动态围栏结构可读。
- [x] 5.6 运行 `git diff --check`、`openspec validate add-conversation-transcript-command --strict` 和 `git status --short`。
- [x] 5.7 按 proposal、全部 requirements/scenarios、design 和 tasks 逐项完成 OpenSpec 完整性/正确性/一致性审计并记录最终验收报告。

## 6. 发布前命令重命名（先于第 5 节执行）

第 1–4 节记录初始 `transcript` 命名实现的已验证事实；本节在发布前将公开入口完整替换为用户批准的 `export`，最终合同以 proposal/specs 为准。

- [x] 6.1 [CAP:cli-command-surface] 将 CLI 测试改名为 `tests/cli-export.test.ts`，把 surface/help/无旧别名断言切换到 `export`，运行聚焦测试并确认 RED。
- [x] 6.2 [CAP:conversation-transcript-export] 将 CLI 实现改名为 `src/commands/export.ts`，只注册 `export` 且移除旧 `transcript` 命令，运行 formatter、CLI 与文件安全聚焦测试并确认 GREEN。
- [x] 6.3 [CAP:conversation-transcript-integration] 将 Claude 资产改名为 `plugins/trimctx/commands/trimctx/export.md`，同步 plugin、Codex skill、用户/开发文档与 package smoke 契约；使用 `rg` 对 `src/`、`tests/`、`plugins/`、`codex/`、`README.md`、`README_zh.md`、`docs/`、`AGENTS.md`、`CHANGELOG.md` 及 `openspec/changes/add-conversation-transcript-command/` 执行发布前旧公开命令与旧路径残留扫描，除第 1–4 节历史实施记录、旧命令 unknown-command 负向场景和内部 transcript 领域标识外不得有残留。
