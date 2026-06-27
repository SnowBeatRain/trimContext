# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.2.8] - 2026-06-27

### Fixed

- Ship the Claude Code `/trimctx:handoff` command asset in the npm package, aligning the plugin README and manifest with the installed files.
- Keep the package-content smoke test checking that `handoff.md` is installed and the removed `resume.md` command file does not return.

### Changed

- Release documentation now describes the current `0.2` series instead of pinning the milestone text to an older patch version.

## [0.2.4] - 2026-06-22

### Added

- Phase 0 trust-loop report metadata via top-level `phase0_trust`, including trust status, manual-review metrics, gates, and review notes.
- Parser diagnostics via top-level `parser_diagnostics`, including source type, parsed message count, source-line range, role counts, empty-content count, and missing-timestamp count.
- `npm run phase0:review` for computing Phase 0 manual-review metrics and producing `phase0-review.json` / `phase0-review.md`.
- Experimental explicit opt-in hook automation through `trimctx install-hooks` and `trimctx init --with-hooks`.

### Changed

- CLI summaries now show `phase0: REVIEW_REQUIRED` and state that candidates are review-only until Phase 0 gates are locked.
- Candidate guidance is more conservative: `compress_candidate` remains report-only, and compression output should not be used as replacement context before Phase 0 trust is locked.
- `trimctx init` no longer installs hooks by default; hooks require explicit experimental opt-in.

## [0.2.3] - 2026-06-22

`0.2.3` is a release milestone for local-first context continuation: it brings resume-aware reports, handoff/next-context artifacts, optional exact token counting for OpenAI/Codex-family inputs, and safer package-visible install guidance into one publishable npm release. It is not a Phase 0 completion marker; real multi-sample validation and compression-strategy tuning continue toward a later release.

### Added

- Resume-aware report metadata and handoff artifacts that preserve likely continuation signals such as goals, decisions, active files, failures, test signals, and next steps.
- Optional `js-tiktoken` integration for exact high-confidence token counts when the peer dependency is installed.
- Tokenizer tests covering exact `tiktoken` metadata and the local heuristic fallback.
- Package-content regression coverage to prevent unsafe download-and-execute install examples from entering published npm artifacts.

### Changed

- Documentation now distinguishes local heuristic estimates from exact `tiktoken` counts in report metadata.
- AI-client install guidance now uses download → review → run examples instead of pipe-to-shell commands.

## [0.2.1] - 2026-06-12

### Added

- `trimctx init` 命令，从 npm 包安装 Claude Code 插件和 Codex skill 到用户目录。
- `trimctx current` 命令，自动发现并分析最新 Claude Code 或 Codex 会话，支持 `--source auto|claude|codex`。
- `trimctx resume` 命令，快捷分析最新 Claude Code 会话（兼容旧入口）。
- `trimctx handoff` 命令，生成确定性 Markdown 交接文档和可选的 `--next-context` 上下文包。
- Claude Code 插件（`plugins/trimctx/`），提供 `/trimctx`、`/trimctx:analyze`、`/trimctx:resume`、`/trimctx:compress` 命令。
- Codex skill（`codex/skills/trimctx/SKILL.md`），通过 skill/CLI 工作流支持 Codex 会话分析。
- GitHub 安装脚本（`install.sh` / `install.ps1`），支持一条命令安装 CLI 和 AI 客户端资产。
- `report` 中的 `summary.score_diagnostics` 字段，包含 `max_rot_score`、`p90_rot_score`、`near_remove_threshold_count`、`protected_high_rot_count` 和 `decision_score_ranges`。
- CLI 版本号从 `package.json` 元数据读取，不再硬编码。

### Fixed

- 压缩时防止输出路径覆盖输入文件（inode 级别检测）。
- OpenAI 格式压缩保留消息数组索引，避免错位。
- Codex/Hermes 格式压缩正确保护 tool 交互记录，保留非消息行。
- Codex parser 对 `function_call` 和 `custom_tool_call` 的 tool 交互设置保护标记。

## [0.2.0] - 2026-06-10

### Added

- Codex/Hermes rollout JSONL parser for `{timestamp, type, payload}` records.
- Automatic `codex-jsonl` source detection before Claude Code/OpenAI fallback detection.
- Codex fixture coverage for `message`, `function_call`, `function_call_output`, `custom_tool_call`, and `custom_tool_call_output` records.
- Documentation updates for Claude Code, OpenAI, and Codex/Hermes rollout input support.

### Changed

- Package metadata now describes Claude Code, OpenAI, and Codex JSONL support.
- v0.2 planning now prioritizes multi-sample validation and compression-effect evaluation before broader session discovery.

## [0.1.0] - 2026-06-08

### Added

- `trimctx analyze <file>` — analyze JSONL conversation files
- `trimctx report <file> -o <report.json>` — write full JSON report
- `trimctx compress <file> -o <output.jsonl>` — generate safe compressed copy
- Claude Code JSONL parser
- OpenAI JSONL parser
- Approximate token counter
- Safety rule engine (protected content detection)
- Rot/staleness scorer with multi-dimensional scoring
- JSON report schema with per-message decisions, reasons, and scores
- Compressor that writes a new file without modifying the original
- Automated tests for parser, safety, scorer, reporter, and compressor
