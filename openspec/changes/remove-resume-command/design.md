## Context

当前项目已经有 `current` 和 `resume` 两个自动会话发现命令，但只有 `current` 的语义与真实实现能力一致。`resume` 会制造“恢复当前窗口”的暗示，而本地 CLI 实际并不知道用户当前身处哪个 AI 客户端窗口，除非客户端通过 hook 明确传入 transcript 路径。

同时，插件资产、README 和使用文档也延续了 `resume` 入口，造成产品叙事不收敛。当前变更只做命令面与文档语义收敛，不扩大集成能力。

## Goals / Non-Goals

**Goals:**

- 删除 `trimctx resume`
- 让 `trimctx current` 成为唯一自动发现入口
- 同步移除插件与打包产物中的 `/trimctx:resume`
- 澄清 `hook`、`install-hooks`、`handoff` 的文档定位

**Non-Goals:**

- 不新增“当前窗口识别”
- 不新增 handoff UID 恢复命令
- 不变更分析逻辑和输出 schema
- 不改变 hooks 的实际执行逻辑

## Decisions

### Decision 1: 直接删除 resume，不保留兼容过渡

用户已明确选择直接移除 `resume`。因此本次不保留废弃别名，也不增加迁移提示逻辑。命令面会立即收敛，文档同步更新到 `current`。

### Decision 2: current 继续通过 --source 表达来源范围

`current` 已经支持 `auto|claude|codex`，足以覆盖此前 `resume` 的 Claude-only 场景。本次不新增新的发现参数，也不修改底层发现实现。

### Decision 3: hook/handoff 只修正文档定位

`hook` 和 `install-hooks` 的实现不变，只在文档里明确：

- `hook` 是被 Claude Code Stop hook 调用的执行器
- `install-hooks` 是实验性的显式安装命令
- 交互式 `init` 会询问是否安装 Claude 当前窗口 hooks，并默认推荐启用
- 非交互 `init` 不隐式安装 hooks，仍需 `--with-hooks`

`handoff` 当前保留 UID 交接包模式，但文档要明确：现在只有“生成包 + 输出 uid”，没有“根据 uid 恢复”的闭环命令。

## Approach

1. 先用测试锁定命令面变化：
   - `--help` 不再包含 `resume`
   - `resume` 相关 CLI 测试移除，`current --source claude` 覆盖其场景
   - 打包测试断言不再包含 `resume.md`
2. 修改 `src/cli.ts` 删除 `resume` 命令注册
3. 删除插件命令文件 `plugins/trimctx/commands/trimctx/resume.md`
4. 更新 README、中文 README、用户文档和状态文档
5. 运行测试和构建，确认无残留引用导致失败

## Risks

- 文档或测试残留 `resume` 引用，导致断言失败或发布内容不一致
- 插件资产与打包清单不同步，导致 npm 包内容测试失败

缓解方式：

- 用 `rg` 全量搜引用点
- 用打包测试验证 npm 内容
- 用 `trimctx --help` 相关测试验证命令面

## Verification

- `node --test` 风格不适用本项目，使用 `npm test`
- `npm run build`
- 必要时单独运行 `tests/cli-commands.test.ts` 与 `tests/package-contents.test.ts`
