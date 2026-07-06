# trimctx 重构前行为基线

> 生成时间：2026-07-06
> 用途：在全面重构前冻结当前 CLI 行为、质量门、包体与 report schema 摘要，作为后续 Phase 的回归对比依据。

## 1. 仓库与版本

- 分支：`refactor/full-command-optimization`
- 基线来源：`origin/main` / `22ab8f5 chore: release 0.2.9`
- package：`trimctx@0.2.9`
- Node：`v23.11.1`（执行环境）
- npm：`10.9.2`（执行环境）

## 2. 重构前质量门

| 检查 | 结果 |
|---|---|
| `npm test` | 18 个测试文件通过，134 个测试通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过，无输出 |
| `npm pack --dry-run --json` | 通过，包名 `trimctx-0.2.9.tgz`，包内 22 个文件 |

> 注意：`npm install` 阶段报告现有依赖审计漏洞（2 moderate / 1 high / 1 critical），这是重构前依赖基线信号，不在 Phase 0 中自动修复，避免引入非重构范围变更。

## 3. CLI help 基线

```text
Usage: trimctx [options] [command]

Analyze and safely trim long AI conversation context.

Options:
  -V, --version              output the version number
  --color                    Colorize output for terminal.
  -h, --help                 display help for command

Commands:
  init [options]             Install AI-client command files and skills for
                             Claude Code and Codex.
  current [options]          Analyze the most recent Claude Code or Codex JSONL
                             session.
  analyze [options] [file]   Analyze a Claude Code, OpenAI, or Codex/Hermes
                             JSONL conversation.
  report [options] <file>    Write a JSON analysis report.
  compress [options] <file>  Write a safe compressed JSONL copy without
                             modifying the original.
  new-chat [options] [file]  Create a new-chat continuation package for a long
                             conversation.
  handoff [options] [file]   Compatibility alias for new-chat: write markdown
                             handoff artifacts for continuing safely.
  hook [options]             Run as a Claude Code Stop hook: analyze session
                             and update CLAUDE.md context state.
  install-hooks [options]    Install experimental Claude Code hooks into
                             settings.json.
```

## 4. 公开命令契约

从 `--help` 与当前源码确认，本轮重构必须保持以下命令入口可用：

- `trimctx`
- `trimctx init [options]`
- `trimctx current [options]`
- `trimctx analyze [options] [file]`
- `trimctx report [options] <file>`
- `trimctx compress [options] <file>`
- `trimctx new-chat [options] [file]`
- `trimctx handoff [options] [file]`
- `trimctx hook [options]`
- `trimctx install-hooks [options]`

兼容/实验入口仍需保持行为兼容，但后续文档中应明确副作用和实验性质：

- `handoff`：`new-chat` 的兼容别名。
- `hook`：Claude hook runtime，会写入项目上下文文件，必须保持 opt-in/实验口径。
- `install-hooks`：Claude hook installer，后续需要重审默认副作用。

## 5. 代表性命令输出摘要

### 5.1 `analyze tests/fixtures/claude-code-realistic.jsonl`

```text
trimctx analysis

  7 messages / ~120 tokens
  token estimate: approx-v1 (local_heuristic, medium confidence)
  tokenizer: local_heuristic (medium confidence)
  context pressure: LOW  removable: 0 tokens (0.0%)
  health: OK  rot: 0.0% (0 candidates)

  trust:
    0 remove candidates means nothing crossed the safe deletion threshold.
    compress candidates, if any, are report-only and kept by default.
    phase0: REVIEW_REQUIRED
    candidates are review-only until Phase 0 gates are locked.
    max score: 0.6021; near threshold: 0
  ! Token counts are approximate local estimates, not model-specific tokenizer counts.

  no rot detected. conversation is clean.

  resume:
    readiness: BLOCKED (35/100)
    goal: none detected
    next: none detected
    active files: 2

  next:
    trimctx report "tests/fixtures/claude-code-realistic.jsonl" -o report.json
    trimctx analyze "tests/fixtures/claude-code-realistic.jsonl" --json
```

### 5.2 `analyze tests/fixtures/codex-realistic.jsonl --json`

结构摘要（不记录消息原文）：

- 顶层字段：`schema_version, input, summary, tokenization, phase0_trust, parser_diagnostics, messages, remove_candidates, warnings, resume`
- summary 字段：`total_messages, total_tokens, remove_candidates, estimated_saving_ratio, estimated_saving_tokens, protected_messages, compress_candidates, token_estimation, token_breakdown, context_pressure, top_reasons, score_diagnostics`
- total messages：`9`
- remove candidates：`0`
- compress candidates：`0`

## 6. Report schema 基线

基于 `report tests/fixtures/claude-code-realistic.jsonl` 生成的 fixture report，记录结构字段，不记录私有 transcript：

- 顶层字段：`schema_version, input, summary, tokenization, phase0_trust, parser_diagnostics, messages, remove_candidates, warnings, resume`
- summary 字段：`total_messages, total_tokens, remove_candidates, estimated_saving_ratio, estimated_saving_tokens, protected_messages, compress_candidates, token_estimation, token_breakdown, context_pressure, top_reasons, score_diagnostics`
- messages item 关键字段：`id, role, content, source, sourceLine, tokens, token_metadata, protected, rot_score, scores, decision, reasons, timestamp, sessionId`
- tokenization 字段：`tokenizer, confidence`
- resume 字段：`decisions, activeFiles, failures, testSignals, nextSteps, readiness`

## 7. npm package 文件列表摘要

- filename：`trimctx-0.2.9.tgz`
- package size：`60114` bytes
- unpacked size：`189347` bytes
- entry count：`22`

包内文件：

- `CHANGELOG.md` (6486 bytes)
- `CONTRIBUTING.md` (1582 bytes)
- `LICENSE` (1060 bytes)
- `README_zh.md` (18476 bytes)
- `README.md` (19715 bytes)
- `codex/skills/trimctx/SKILL.md` (4223 bytes)
- `dist/cli.js` (64825 bytes)
- `docs/dev/requirements.md` (5464 bytes)
- `docs/dev/roadmap.md` (11459 bytes)
- `docs/user/usage_zh.md` (19931 bytes)
- `docs/user/usage.md` (20843 bytes)
- `install.ps1` (3237 bytes)
- `install.sh` (2080 bytes)
- `package.json` (2093 bytes)
- `plugins/trimctx/.claude-plugin/plugin.json` (271 bytes)
- `plugins/trimctx/.system` (1023 bytes)
- `plugins/trimctx/commands/trimctx.md` (2330 bytes)
- `plugins/trimctx/commands/trimctx/analyze.md` (514 bytes)
- `plugins/trimctx/commands/trimctx/compress.md` (860 bytes)
- `plugins/trimctx/commands/trimctx/handoff.md` (868 bytes)
- `plugins/trimctx/commands/trimctx/new-chat.md` (796 bytes)
- `plugins/trimctx/README.md` (1211 bytes)

## 8. 非目标清单

本轮重构仍不引入以下能力，避免范围膨胀：

- Web UI
- MCP server
- REST API
- LLM summarization
- embedding / semantic detector
- Python sidecar
- `resume <uid>`
- 全局数据库 / registry
- 新的 public command 面（除非后续 Phase 明确授权）

## 9. 隐私与提交边界

- 本文档只记录 fixture、命令帮助、schema 字段和包体摘要。
- `.hermes/baseline/` 中的原始执行输出仅作为本地执行证据，不作为公共文档要求提交。
- 不记录真实私有 JSONL 原文，不提交 `tmp-real-validation/` 或真实样本报告。

## 10. 后续使用方式

后续每个重构 Phase 完成后，至少对比：

1. `node --import tsx src/cli.ts --help`
2. `node --import tsx src/cli.ts --version`
3. `node --import tsx src/cli.ts analyze tests/fixtures/claude-code-realistic.jsonl`
4. `node --import tsx src/cli.ts analyze tests/fixtures/codex-realistic.jsonl --json`
5. `npm test`
6. `npm run build`
7. `npm pack --dry-run --json`

如用户可见输出发生变化，必须有测试和文档解释；如 schema 字段发生变化，必须保持 additive 或提供兼容层。
