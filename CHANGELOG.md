# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
