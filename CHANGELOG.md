# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
