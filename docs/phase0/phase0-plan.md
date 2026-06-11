# Phase 0 Validation Plan

Phase 0 validates whether trimctx is safe enough for other people to try on real long-running AI conversations. Unit tests prove parser contracts; Phase 0 proves the default scoring and compression behavior on realistic data.

## Scope

Validate the full local pipeline on private JSONL exports:

1. `trimctx analyze --json`
2. `trimctx report -o <report.json>`
3. `trimctx compress -o <trimmed.jsonl>`
4. input hash before/after compression
5. manual review of `remove_candidates`

Supported sources to cover:

- Claude Code JSONL
- OpenAI JSONL
- Codex/Hermes rollout JSONL

## Dataset

Use at least 5 private samples before calling Phase 0 complete.

| Source | Minimum samples | Minimum shape |
| --- | ---: | --- |
| Claude Code JSONL | 2 | long sessions with tool calls and corrections |
| OpenAI JSONL | 1 | multi-message conversation or batched records |
| Codex/Hermes rollout JSONL | 2 | `{timestamp, type, payload}` rollout exports |

Place raw samples under `datasets/private/phase0/`. This path is gitignored and must not be committed.

## Outputs

Write machine outputs under `reports/phase0/`. This path is gitignored.

Expected files:

- `reports/phase0/phase0-results.json`
- `reports/phase0/<sample>.report.json`
- `reports/phase0/<sample>.trimmed.jsonl`

## Command

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

The script prints JSON to stdout and writes the same aggregate file to `reports/phase0/phase0-results.json`.

## Acceptance Criteria

| Metric | Target | How to measure |
| --- | ---: | --- |
| Parser success rate | >= 95% | `analyze_ok / sample_count` in `phase0-results.json` |
| Report success rate | >= 95% | `report_ok / sample_count` in `phase0-results.json` |
| Compress success rate | >= 95% | `compress_ok / sample_count` in `phase0-results.json` |
| Input mutation | 0 files | `input_unchanged == sample_count` |
| Critical false deletion | 0 | manual review of every remove candidate |
| Protected recall | 100% | manual review of recent, system, correction, and tool-result-sensitive content |
| Remove-candidate precision | >= 70% | accepted remove candidates / reviewed remove candidates |

## Completion Checklist

- [ ] At least 5 samples were run.
- [ ] All supported source families were represented.
- [ ] No raw private JSONL files appear in `git status`.
- [ ] `phase0-results.json` shows all input hashes unchanged.
- [ ] Every `remove_candidate` was manually labeled.
- [ ] Critical false deletions are zero.
- [ ] Validation summary is filled from the template.
- [ ] Any rule changes are backed by a new unit test.
