# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.3.0] - 2026-08-12

### Added

- Added `trimctx export [file] -o <conversation.md>` for deterministic, unredacted export of every parser-normalized message, with auditable source metadata and Markdown-safe dynamic fences.
- Added `/trimctx:export` to the Claude Code plugin and explicit-file export guidance to the Codex skill.

### Changed

- Expanded the public CLI surface from five commands to six while preserving the existing analyze, report, new-chat, and compression contracts.
- Transcript writes now reuse input-identity checks, a pre-read input snapshot, and atomic replacement so the source JSONL stays read-only and existing outputs survive failures.
- Human-readable analyze summaries and Markdown reports now use consistent Chinese status, confidence, finding, continuation, and recommendation copy; assessment limitations are shown once in their dedicated section while Report v2 field names and English machine copy remain stable.
- Report v2 now preserves established negative risk statuses when observability limitations remain, aggregates key findings by signal code with decision-based severity, and bounds Markdown evidence plus review-queue previews. Candidate groups, full JSON review queues, decisions, scorer thresholds, and compression behavior remain unchanged.
- Markdown review tables now partition protected and unprotected items, show bounded previews with omitted-count notes, and leave the complete review queue in JSON.
- Session discovery is now split into a read-only local catalog and trusted current-window binding resolver, with the existing discovery facade preserved and injectable home/environment dependencies for focused tests; CLI selection and fallback behavior are unchanged.
- Report construction is now split into focused evidence, findings, and review modules while `createReport()` remains the orchestration facade; direct boundary tests and byte-identical real-sample JSON/Markdown outputs preserve the Report v2 schema, ordering, validation, and safety behavior.
- Init now separates pure asset planning, injectable target prompting, and filesystem installation while command registration captures its own package root; real installs preflight all templates and destination conflicts before copying, preventing predictable partial multi-client installs without changing paths, prompts, hooks, or successful output.
- Claude hook installation now fails closed on malformed or unreadable settings, preserves unrelated entries sharing a hook group during `--force`, and atomically replaces valid settings through separated pure-planning and installer modules; dry-run remains privacy-safe and hook runtime scope is unchanged.
- Claude hook settings now pin safely quoted absolute Node and packaged `dist/cli.js` paths. Settings writes compare the original bytes before replacement, `--force` migrates exact legacy trimctx commands, and marked stale absolute paths are replaced without removing user hooks.
- Persisted report previews, continuation summaries, and CLAUDE.md state now share credential redaction for standard GitHub and other token families, authorization headers, credential URLs, email addresses, and key/value secrets; full JSON reports and exports remain private artifacts that require review.
- Automatic Claude hooks now cap stdin at 1 MiB and Stop analysis at a 64 MiB transcript or 10,000 normalized messages before analysis-side writes; explicit CLI commands keep their existing behavior.

### Fixed

- Codex skill installation guidance now reflects the existing npm release and lists the complete five-file `new-chat` package, including `README.md`.
- Phase 0 now binds `analyze --json`, `report`, and `compress` to the sample's initial SHA-256 by validating each command's exact input Buffer before parsing or writing a new artifact. Results/review v2 expose only aggregate binding evidence; older v2 evidence without the marker remains review-required, while malformed or inconsistent evidence fails closed.
- Compression now captures the open input snapshot before reading and commits through same-directory atomic replacement. Input changes during preparation are rejected, and recoverable stage/identity/commit failures preserve an existing compressed copy without changing candidate selection or output bytes.
- Compression now rejects duplicate normalized message IDs before creating or replacing output, preventing ID-set filtering from deleting the wrong record while leaving analyze/report behavior unchanged.
- The shared distinct-output writer now closes every opened handle with all-settled semantics and preserves the original open/stat/write failure together with all close failures in deterministic order. Lone failures retain their existing error identity, while compression and `new-chat` successful output behavior is unchanged.
- Local session discovery now treats only `ENOENT` as a missing root, subtree, or rotated-away JSONL. Permission and I/O failures from directory or candidate inspection propagate through latest-session and `new-chat` fallback resolution instead of being reported as an empty catalog.
- Shared file identity and Windows replacement checks now treat only `ENOENT` as absence. Permission or I/O failures propagate instead of being classified as different/non-regular files, and simultaneous Windows rename/inspection failures retain both ordered causes without changing the existing target.
- Phase 0 batch validation now treats analyze/report/compress as successful only when their required output contracts are usable. Analyze JSON plus report JSON and compressed artifacts are validated independently; missing, non-regular, unreadable, malformed, or non-object outputs become per-sample failures without aborting final evidence or echoing private content, while process exit codes and the results schema remain unchanged.
- Phase 0 analyze/report validation now requires a minimum `trimctx.report.v2` contract after JSON parsing: supported source metadata, non-negative summary counts and score diagnostics, candidate/message arrays, and string warnings. Structurally invalid objects retain the child exit code but no longer count as successful, and fixed errors do not echo invalid values or private report content; this is intentionally narrower than full Report v2 schema validation.
- Report v2 continuation extraction now keeps tool containers out of current-goal, decision, next-step, and tool-result-derived active-file evidence. Tool failures/tests remain visible at low confidence, and readiness weights count only medium/high evidence, preventing adapter-wrapped tool output from overstating new-chat readiness without changing message analysis, candidate decisions, or compression.
- Report v2 `clarify_continuation` recommendations now enumerate only the categories already present in `resume.readiness.missing`; terminal and Markdown copy derive from the same list, without changing the schema, readiness calculation, recommendation ordering, scoring, or compression.
- Report v2 observability now counts only warnings that reduce input or measurement visibility. Compacted-session and approximate-token warnings retain their existing effect, while the report-only `compress_candidate` notice remains in the public warning list without inflating observability evidence or blocking an otherwise healthy assessment.
- Report v2 now rejects remove or compress candidates without at least one reason, and Phase 0 review independently counts missing, empty, or non-array candidate reasons as privacy-safe report-quality issues that prevent trust from being locked. Scoring, thresholds, protected decisions, and compression behavior are unchanged.
- Init asset installation now stages every selected client before commit, swaps existing trimctx directories through same-parent backups, and rolls back earlier targets when a later copy or rename fails. Restore and cleanup failures retain recoverable artifacts and report all causal errors; forced process termination remains outside the in-process transaction guarantee.
- Init destination checks now treat only `ENOENT` as a missing asset; permission and other filesystem errors abort before staging instead of being misclassified and surfacing later as unrelated rename failures.
- Shared path-existence checks used by `new-chat` now propagate permission and I/O failures instead of treating them as a missing UID package directory and continuing into output creation.
- `new-chat` now writes its five files with private permissions in a private staging directory, rechecks both the opened transcript snapshot and saved staging identity, and publishes the complete package with one directory rename so the final UID path is not partially visible during normal execution. Failed writes clean up only a staging directory whose reliable identity still matches; replacement-path and cleanup failures preserve every cause and retain recoverable artifacts instead of recursively deleting unknown content.
- File-identity-dependent writers now fail closed when a filesystem reports an unreliable zero inode, before appending, truncating, or committing output bytes. The Node.js path API still cannot provide directory-handle-relative operations, `renameat2(RENAME_NOREPLACE)`, or crash-consistent transactions: a hostile writer with parent-directory access can race path resolution and the final absence check, and abrupt termination can leave a private staging directory.
- Atomic file writes now track ownership of their random temp path, stop deleting that name after open failure or commit transfer, and aggregate operation, handle-close, and temp-cleanup failures. Residual temp files remain locatable without echoing their potentially sensitive contents.
- The top-level CLI now recursively formats `AggregateError` leaves in their original order, so init, new-chat, and atomic-write restore or cleanup failures are visible instead of being hidden by the transaction summary; ordinary single-error output is unchanged.
- `init --with-hooks` now validates malformed, unreadable, or structurally invalid Claude settings before writing any Claude or Codex asset. Real installs still write assets before atomically updating freshly reread settings, while failed preflight leaves both settings and client assets unchanged.
- Phase 0 batch validation now plans every report and trimmed output before creating the output directory or starting CLI work. It rejects normalized/truncated sample-ID collisions, Windows case-equivalent IDs, and input/output directory aliases instead of silently overwriting evidence or re-ingesting prior trimmed files; successful artifact names and analysis/compression behavior are unchanged.
- Phase 0 batch validation now stages `phase0-results.json` and `validation-summary.md` together and commits them through the same backup-based transaction as review artifacts. Recoverable failures preserve the previous evidence pair, while restore or cleanup failures retain recovery artifacts and report all causes; per-sample outputs and result schemas are unchanged.
- Phase 0 review now combines manual labels with the sibling `phase0-results.json` batch evidence before returning `locked`. It recomputes execution/input-integrity counts, enforces five-sample Claude/OpenAI/Codex coverage, matches successful report IDs to loaded reports, and writes privacy-narrowed `trimctx.phase0.review.v2` artifacts without reports/labels paths, command errors, message content, or review notes.
- Phase 0 review now rejects non-v2 current reports, malformed report-message records, and duplicate per-sample message IDs before trust can be locked. Review artifacts expose only aggregate report-quality counts, while valid reports retain the existing manual metrics and thresholds.
- Phase 0 batch evidence now uses `trimctx.phase0.results.v2` and records the exact-byte SHA-256 of every successfully validated report. Review recomputes hashes from the same bytes used for message metrics, requires report IDs and hashes to match, and reports legacy evidence or changed same-name artifacts through fixed privacy-safe issues instead of locking trust.
- Phase 0 analyze/report success now requires each valid Report v2 `input.file` to exactly match the current batch sample path. Reports from another input become privacy-safe per-command failures, mismatched report artifacts receive no SHA-256, and valid analyze/report metadata fallback remains available without restoring a failed status.
- Phase 0 now binds complete `analyze --json` and JSON report semantics through canonical private SHA-256 evidence. Formatting and object-key order are ignored while arrays and every Report v2 value remain significant; runner mismatches fail the sample, review independently recomputes the current report semantics, and public artifacts expose only counts and fixed issues.
- Phase 0 review now binds source coverage to each successful report's actual `input.source` instead of trusting results metadata alone. Report/result source mismatches and missing successful-report coverage remain review-required through aggregate-only metrics and fixed privacy-safe issues; valid results v2 needs no migration.
- Phase 0 review now validates each results v2 input SHA-256 pair against its `input_unchanged` flag and binds every successful result sample to the actual report `input.file`. Contradictory evidence and mismatched inputs can no longer lock trust, while coherent input mutations retain the existing failed execution-gate semantics without rereading private transcripts.
- Phase 0 now records `output_sha256` for every successfully validated compressed artifact and recomputes it during review. Same-name byte drift, missing legacy v2 digest evidence, malformed digests, duplicate IDs, and artifact-set mismatch remain independent privacy-safe review blockers with aggregate-only output.
- Phase 0 compressed artifacts are now re-read through the report-declared source adapter and compared as normalized retained-message multisets during both batch validation and review. Malformed JSONL, message-set drift, and unavailable report references cannot lock trust; review exposes only aggregate counts and fixed issues, and this does not change candidate decisions, compression bytes, schema versions, or the manual-review requirement.
- Phase 0 review now stages its JSON and Markdown outputs together and commits them with backup-based rollback, preventing recoverable failures from leaving mixed audit snapshots. Rollback and cleanup failures retain recoverable artifacts and report all causes; hard termination and concurrent writers remain outside the in-process guarantee.
- Phase 0 review now counts missing or invalid label decisions and empty review notes as privacy-safe label-quality issues, preventing incomplete manual audit records from bypassing decision-mismatch checks and locking trust.
- Phase 0 review now counts label categories that are incompatible with their referenced report decisions as privacy-safe label-quality issues. Delete labels apply only to `remove_candidate`, protected labels apply only to protected messages, and mismatch details remain excluded from review artifacts.
- Phase 0 review metrics now count only effective manual labels in precision, recall, and protected coverage denominators. Duplicate, incomplete, decision-mismatched, or category-incompatible labels no longer appear as completed review, while `critical_keep` on a `remove_candidate` remains a conservative critical-false-deletion signal.
- Phase 0 review now accepts the legacy `critical_false_delete` label as an alias for `critical_keep`, keeping older private label files usable while preserving privacy-narrowed outputs and existing critical false deletion metrics.
- Phase 0 review now accepts rubric labels `needs_summary` and `unclear` as non-locking aggregate evidence. `needs_summary` applies only to non-remove messages, `unclear` applies to any reviewed message, and neither label satisfies precision, recall, protected-coverage, or trust-locking review denominators.
- Phase 0 batch validation summaries and the validation-summary template now include pending manual-review rows for protected review coverage plus `needs_summary` and `unclear`, keeping the pre-label summary aligned with the accepted review rubric.
- Phase 0 review now rejects malformed report JSON, malformed label JSON, and non-object label records with stable file/line diagnostics that do not echo private input or internal parser errors. Existing review artifacts remain unchanged, and aggregate transaction failures now print every ordered leaf cause instead of hiding restore or cleanup errors behind the top-level message.
- Claude Stop hooks now include a not-yet-persisted final reply from the validated `last_assistant_message` stdin field in their in-memory analysis snapshot. An equivalent newest assistant message is deduplicated conservatively, while public analysis/export/compression behavior and the original transcript remain unchanged.
- Claude hook stdin now parses through a shared runtime boundary that rejects invalid top-level or known-field types before side effects, permits unknown Claude fields, and reports malformed JSON without echoing the input content.
- Claude SessionStart now appends a complete transcript/session binding snapshot; when hook input omits the optional `session_id`, an empty binding clears any older ID in the same window-specific `CLAUDE_ENV_FILE` without modifying either transcript.
- Claude SessionStart now appends through an open handle whose filesystem identity is checked against the transcript immediately before writing. A `CLAUDE_ENV_FILE` that is the transcript or an existing symlink/hardlink alias fails closed without changing either name; the two-export append format and missing-transcript behavior remain unchanged.
- Claude SessionStart now preflights the transcript handle before opening or creating `CLAUDE_ENV_FILE`. Invalid, inaccessible, or otherwise uninspectable transcript paths therefore fail without leaving an empty env target, while a genuinely missing future transcript remains supported.
- Claude Stop hook runtime now treats only `ENOENT` as a missing project `CLAUDE.md`, rejects other read failures with the target path, and atomically creates or replaces the trimctx-managed state through a focused storage boundary. This Stop-specific storage change leaves SessionStart handling, managed-block scope, analysis behavior, and transcript read-only guarantees untouched.
- Claude Stop hook `CLAUDE.md` writes now bind the proposed managed-block update to the exact bytes, or exact absence, observed by the hook read. Changed, deleted, or concurrently created targets fail closed and remain untouched; the conditional atomic writer rechecks before commit and before the Windows replacement fallback without adding locks or automatic retries.
- CLAUDE.md context-state updates now reject incomplete, reversed, or duplicate trimctx markers instead of guessing ownership, and valid replacement/removal preserves every byte outside the exact managed marker range.
- Transcript-derived current goals are now re-sanitized at the CLAUDE.md persistence boundary: authorization and common credential forms are redacted, exact trimctx markers are neutralized, control/whitespace runs are collapsed, and display remains capped at 220 characters without changing Report v2 resume data.
- Repository install scripts now reject unsafe root/home targets, mismatched checkout origins, and unowned plugin directories before writes. Plugin ownership is checked again immediately before recursive replacement; marker-owned and exact legacy trimctx plugin layouts remain upgradable, while unknown directory contents are preserved.
- Claude Stop transcript reads now remain bounded when the file grows after its initial size check, reading at most the 64 MiB limit plus one sentinel byte before rejecting the hook.

## [0.2.11] - 2026-07-23

### Added

- Added human-readable Markdown health reports through `trimctx report <file> -o report.md`; JSON output remains available through `.json` and `analyze --json` with the `trimctx.report.v2` schema.
- Added structured signal evidence, an independent health assessment, findings, review queues, and candidate groups for auditable context review.
- Added health status, health confidence, and report schema version to new-chat manifests.

### Changed

- Consolidated the public workflow around `init`, `analyze`, `report`, `new-chat`, and `compress`. The former `current`, `handoff`, and `install-hooks` entry points are migration history; use bound `trimctx`/`analyze`, `new-chat`, and `init --with-hooks` respectively.
- Short summaries now use assessment evidence, at most two findings, continuation gaps, and the first recommendation without exposing internal score breakdowns.
- Tool-use and tool-result records now stay structurally protected from physical deletion, and removal decisions require decisive high-confidence evidence.
- Report writes now use same-directory atomic replacement while preserving the original transcript and existing targets on failure.
- Documented multi-window session targeting: Claude Code uses per-window hook bindings, while Codex workflows require an explicitly confirmed JSONL path when exact window identity matters.

## [0.2.10] - 2026-07-16

### Added

- Added explicit local session discovery through `trimctx analyze --select` and `trimctx analyze --latest`, with optional Claude/Codex source filtering.
- Added an interactive session picker for the no-subcommand workflow when no current-window binding is available.

### Changed

- Made `trimctx current` strict: it analyzes only the transcript bound to the current AI client window and never falls back to latest-file discovery.
- Split CLI registration, analysis pipeline, session discovery, option parsing, and platform file helpers into focused modules without changing scoring thresholds.
- Extracted report summaries, Codex tool-item normalization, and ROT metric computation into focused helpers without changing public CLI behavior or scoring thresholds.
- Aligned Claude Code hooks, packaged assets, Codex guidance, and user documentation with the strict current-window contract and documented Stop-hook write scope.

### Fixed

- Prevented `install-hooks --dry-run` from printing existing Claude settings, including environment values and permissions.
- Made the packed-install smoke test resolve the platform-correct npm global directory on Windows.
- Bound transcript reads and derived-output writes to the same open input handle, preventing hard-link and path-replacement races from overwriting the original transcript.
- Tightened SessionStart bindings and `current` validation so missing, unreadable, directory, or session-id-mismatched transcript paths fail with actionable guidance.


## [0.2.8] - 2026-06-27

### Fixed

- Ship the Claude Code `/trimctx:new-chat` command asset in the npm package, aligning the plugin README and manifest with the installed files.
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

`0.2.3` is a release milestone for local-first context continuation: it brings resume-aware reports, new-chat/next-context artifacts, optional exact token counting for OpenAI/Codex-family inputs, and safer package-visible install guidance into one publishable npm release. It is not a Phase 0 completion marker; real multi-sample validation and compression-strategy tuning continue toward a later release.

### Added

- Resume-aware report metadata and new-chat continuation artifacts that preserve likely continuation signals such as goals, decisions, active files, failures, test signals, and next steps.
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
- `trimctx new-chat` 命令，生成确定性 Markdown 交接文档和可选的 `--next-context` 上下文包。
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
