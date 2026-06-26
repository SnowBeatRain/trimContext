## 1. CLI 命令面收敛

- [x] 1.1 [CAP:cli-command-surface] 在 `tests/cli-commands.test.ts` 中新增或修改失败测试，断言 `trimctx --help` 不再出现 `resume`
- [x] 1.2 [CAP:cli-command-surface] 删除 `tests/cli-commands.test.ts` 中针对 `resume` 的命令行为测试，并用 `current --source claude` 保留覆盖
- [x] 1.3 [CAP:cli-command-surface] 修改 `src/cli.ts`，移除 `resume` 命令注册，仅保留 `current`

## 2. 插件与打包资产同步

- [x] 2.1 [CAP:client-integration-assets] 在 `tests/package-contents.test.ts` 中先写失败断言，要求打包产物不再包含 `plugins/trimctx/commands/trimctx/resume.md`
- [x] 2.2 [CAP:client-integration-assets] 删除 `plugins/trimctx/commands/trimctx/resume.md`
- [x] 2.3 [CAP:client-integration-assets] 如存在镜像资产，同步删除仓库内对应 `resume` 命令文件

## 3. 文档语义收敛

- [x] 3.1 [CAP:cli-command-surface] 更新 `README.md` 与 `README_zh.md`，移除 `resume` 命令说明，统一改为 `current`
- [x] 3.2 [CAP:client-integration-assets] 更新 `docs/user/usage.md` 与 `docs/user/usage_zh.md`，澄清 `hook` / `install-hooks` 的区别与 `init` 的默认行为
- [x] 3.3 [CAP:handoff-command-positioning] 更新 README 和使用文档中的 `handoff` 描述，明确当前没有 `resume <uid>` 闭环

## 4. Verify

- [x] 4.1 运行 `npm test`
- [x] 4.2 运行 `npm run build`
