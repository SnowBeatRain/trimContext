## Why

当前 CLI 同时暴露 `trimctx resume` 和 `trimctx current` 两个“自动发现会话并分析”的入口，实际能力高度重叠，但命名语义不一致：

- `resume` 实际只会扫描 Claude Code 最近会话，容易被误解为“恢复当前会话窗口”
- `current` 才是更接近“自动发现最近可用会话”的真实语义

这会增加用户心智负担，也让文档对 `hook`、`install-hooks`、`handoff` 的定位变得模糊。需要收敛命令面，避免把尚不存在的“当前窗口恢复”能力包装成产品承诺。

## What Changes

- 删除 `trimctx resume` CLI 子命令
- 将 `trimctx current` 定义为唯一的自动会话发现入口
- 更新帮助文案、README、使用文档、插件命令和打包断言
- 澄清 `trimctx hook`、`trimctx install-hooks`、`trimctx handoff` 的产品定位

## Core Features

- 删除重复且语义误导的 `resume` 命令
- 保留 `current --source auto|claude|codex` 作为唯一自动发现入口
- 明确 `hook` 是集成执行器，`install-hooks` 是实验性显式安装命令
- 明确 `handoff` 当前产出的是 UID 交接包，不是 `resume <uid>` 闭环

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `cli-command-surface`：收敛自动发现命令入口并修正文档语义
- `client-integration-assets`：移除 `/trimctx:resume` 相关资产与说明，并澄清交互式 init 可安装 Claude 当前窗口 hooks
- `handoff-command-positioning`：澄清 handoff 的当前边界和用途

## Impact

- `src/cli.ts`
- `tests/cli-commands.test.ts`
- `tests/package-contents.test.ts`
- `README.md`
- `README_zh.md`
- `docs/user/usage.md`
- `docs/user/usage_zh.md`
- `plugins/trimctx/commands/`
- 可能涉及 `.claude/plugins/trimctx/commands/` 镜像资产

## Non-Goals

- 不新增跨客户端“当前窗口识别”能力
- 不新增 `resume <uid>`、`continue <uid>` 或其他 handoff 恢复命令
- 不修改分析、报告、压缩、resume-state 提取逻辑
- 不让非交互 `init` 隐式安装 hooks；交互式 `init` 可以询问并默认推荐启用 Claude hooks

## Open Questions

- None
