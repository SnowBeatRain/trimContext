# Phase 0 Validation Plan

Phase 0 validates whether trimctx is safe enough for other people to try on real long-running AI conversations. Unit tests prove parser contracts; Phase 0 proves the default scoring and compression behavior on realistic data. Phase 0 is not complete until manual-review gates are locked.

## Scope

Validate the full local pipeline on private JSONL exports:

1. `trimctx analyze --json`
2. `trimctx report -o <report.json>`
3. `trimctx compress -o <trimmed.jsonl>`
4. input hash before/after compression
5. validated input SHA-256 evidence plus report/compressed artifact SHA-256, report source/input binding, compressed JSONL readability, and retained-message correspondence
6. manual labels for candidates and protected context
7. `phase0:review` gate calculation

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

Place raw samples under `datasets/private/phase0/`. This path is gitignored and must not be committed. Place private labels under `datasets/private/phase0-labels/` or another gitignored path.

## Outputs

Write machine outputs under `reports/phase0/`. This path is gitignored.

Expected files:

- `reports/phase0/phase0-results.json`
- `reports/phase0/phase0-review.json`
- `reports/phase0/phase0-review.md`
- `reports/phase0/<sample>.report.json`
- `reports/phase0/<sample>.trimmed.jsonl`

`phase0-results.json` uses `trimctx.phase0.results.v2` and is private by default: it may include local filesystem paths, exact report and compressed-artifact SHA-256 values, plus captured `stderr` or `error` details. Do not publish it directly; share only a sanitized validation summary or a manually redacted excerpt.

Each generated report includes top-level `phase0_trust` and `parser_diagnostics`. `phase0_trust.status` defaults to `review_required`; that is a prompt for manual review, not a completion claim.

## Commands

Run the batch validator:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

The input and output arguments must resolve to different real directories. Input basenames must also remain unique after Phase 0 replaces unsupported characters and applies its 120-character sample-ID limit; Windows treats case-only ID differences as collisions. The runner checks both constraints for the complete batch before creating the output directory, starting a CLI subprocess, or writing an artifact; rename a colliding input instead of relying on overwrite order.

The script prints JSON to stdout and writes the same aggregate file to `reports/phase0/phase0-results.json`. The complete JSON and `validation-summary.md` bodies are both staged before either final target changes, then committed as one in-process backup-based transaction. Recoverable failures restore the previous pair; restore or cleanup failures report every cause and retain any recovery artifact that could not be restored or removed. Forced termination, power loss, operating-system failure, and concurrent batch writers do not have a persistent journal or lock. Per-sample reports and trimmed copies are produced before this final transaction and retain their existing behavior.

For each sample, the runner computes the initial input SHA-256 once and passes it to all three source CLI subprocesses through the internal `TRIMCTX_PHASE0_EXPECT_INPUT_SHA256` environment variable. Each command hashes the exact Buffer it then decodes and parses; it never hashes the path and reopens it for parsing. A malformed expectation or digest mismatch fails the child before analyze output or a new report/compressed target is written. The final input hash remains independent evidence that the path also contains the original bytes when the sample run ends. Results v2 records `input_sha256_bound:true` per sample and `aggregate.input_sha256_bound`; validation Markdown exposes only the count. Ordinary CLI runs without the internal variable keep their existing behavior and avoid the extra hash.

For `analyze` and `report`, `ok` means both the child process and its required JSON contract succeeded. A zero process exit with blank, malformed, or non-object analyze JSON, or with a missing, non-regular, unreadable, malformed, or non-object report artifact, is stored as `ok: false` while retaining `exit_code: 0`. A parsed object must also satisfy the minimum `trimctx.report.v2` contract: the exact schema version; a string input file; a supported Claude Code, OpenAI, or Codex source; non-negative integer message/token/candidate/protected totals; non-negative score-diagnostic counts and finite non-negative maximum ROT score; message/candidate/warning arrays; and string warning entries. Its `input.file` must then exactly equal the absolute input path passed to that batch sample. This is a strict Report v2 contract binding, not basename, case-folded, `realpath`, or inode equivalence. This gate protects only the fields consumed by Phase 0 aggregation and evidence, not the full Report v2 schema or message-level review contract. For every successful report, results v2 records `report_sha256` from the exact Buffer used for JSON parsing, contract validation, and input-identity validation; failed reports omit it. Contract or input-identity failures reduce the corresponding Phase 0 success count and mark only that sample as failed; the runner still writes final batch evidence. Stable errors include the artifact path when needed, but never copy analyze stdout, report content, a mismatched declared input path, invalid field values, JSON parser fragments, or stack traces. A valid report remains the preferred summary metadata source, with valid analyze JSON used only as fallback; fallback metadata never changes a failed command back to successful.

When both command outputs are independently valid, the runner also requires their complete parsed Report v2 JSON values to match. It recursively sorts object keys, preserves array order and every JSON primitive, hashes the canonical UTF-8 JSON, and records `analyze_report.status` plus the private analyze semantic SHA-256. Formatting and object-key order do not matter; no Report v2 field is exempt. A mismatch keeps both command `ok` values intact but makes the distinct sample gate fail, reduces `aggregate.analyze_report_matched`, and adds the sample to `aggregate.failed_samples`. A failed command records `unavailable` without a digest. The private results file retains the digest needed for review; validation Markdown exposes only the matched count.

For `compress`, `ok` additionally requires the generated `.trimmed.jsonl` target to exist, be a regular file, and be readable as exact bytes. When the matching report artifact passed its existing contract and input binding, the same compressed Buffer must be re-readable by the adapter selected by `report.input.source`, and its normalized-message multiset must exactly equal `report.messages` after excluding `remove_candidate`. The process-local identity uses source, role, content, optional timestamp, and optional session ID with duplicate counts; it never uses IDs or source lines, which can change after Codex line removal or OpenAI batch reindexing. Malformed JSONL, valid-JSON message drift, or unusable report message identities retain the child exit code but turn `compress.ok` false through fixed errors that do not echo content, fingerprints, parser errors, IDs, or mismatched values. Every successful result records `compress.output_sha256` from that exact Buffer; failed results omit it. If the report artifact itself is invalid, the runner retains compression's independent file/hash result because the report already fails the sample and no valid report decision set exists. A failed compress subprocess still does not inspect a possibly stale target.

Run manual-review aggregation after labels are filled:

```bash
npm run --silent phase0:review -- --reports reports/phase0 --labels datasets/private/phase0-labels --out reports/phase0
```

The review step automatically reads `phase0-results.json` from the reports directory. Every result must contain a non-empty, unique sample path and lowercase 64-character before/after input SHA-256 values; `input_unchanged` must exactly equal whether those digests match. Contradictory or malformed input evidence produces `invalid_phase0_results`, while a coherent before/after difference retains the existing `input_mutation_detected` execution failure. Every fresh result also carries `input_sha256_bound:true`, and the aggregate count must match. Older results v2 without the sample or aggregate evidence produces `input_sha256_binding_unavailable` and requires a fresh batch; malformed present values are invalid, while a well-formed count drift uses `aggregate_mismatch`. Review recomputes `aggregate.failed_samples` in results order from analyze/report semantics, analyze/report/compress command outcomes, and input integrity, then requires an exact array match. It verifies that each successful report's ID, exact-byte SHA-256, source declaration, and sample path match the loaded `*.report.json` file. It computes each digest and reads `input.source` plus `input.file` from the same Buffer it parses for message metrics. A changed report produces `report_hash_mismatch`; a source disagreement produces `report_source_mismatch`; a result sample/report input disagreement produces `report_input_mismatch`; these artifact readiness issues remain `review_required` and never expose the mismatched value. Source coverage counts only expected successful report IDs and their actual supported report sources; analyze-only metadata, missing reports, stale extra reports, or invalid sources cannot satisfy the 2 Claude/1 OpenAI/2 Codex gate. Legacy results v1 produces `report_integrity_unavailable` and must be regenerated. An otherwise-valid older results v2 item whose successful compress record lacks `output_sha256` produces `compressed_integrity_unavailable` and also requires a fresh batch; a present malformed digest produces `invalid_phase0_results`. Review does not reopen original transcripts, because they may legitimately move or grow after the batch. It also checks the gate-relevant shape of every report message and label as before. These checks are intentionally narrower than full report or label schema validation.

Review independently canonicalizes the current report object from the same parsed Buffer used for byte hash, source, input, message metrics, and compressed validation. `expected_analyze_report_pairs` counts samples whose two commands independently succeeded; `matched_analyze_report_semantics` additionally requires batch status `matched` and equality between the recorded analyze digest and current report semantics. Batch or current-state drift produces `analyze_report_semantic_mismatch`. Missing legacy results v2 evidence produces `analyze_report_semantic_validation_unavailable` and requires a fresh batch, while malformed present status/digest/aggregate combinations remain `invalid_phase0_results`. Review JSON/Markdown never exposes semantic digests, canonical JSON, field-level differences, paths, IDs, or content.

Review also checks label category compatibility with the referenced report message. `safe_remove`, `questionable_remove`, and `critical_keep` may label only `remove_candidate`; `protected_keep` and `over_protected` may label only protected messages; `missed_low_value_noise` may label only unprotected non-remove messages such as kept messages or report-only `compress_candidate`; `needs_summary` may label only non-remove messages such as `compress_candidate`, `keep`, or protected content; `unclear` may label any reviewed report message. Mismatches are aggregated as `incompatible_label_categories`, count toward `label_quality_issues`, and keep trust `review_required` without exposing label values, message IDs, paths, content, or review notes.

Manual precision, recall, and coverage denominators count only effective locking labels: exactly one label for the referenced message, valid label decision matching the report decision, compatible label category, and a non-empty review note. `needs_summary` and `unclear` are accepted as non-locking evidence counters but do not satisfy required review denominators or Phase 0 trust gates. `critical_keep` labels attached to `remove_candidate` messages remain conservative safety signals and still count toward `critical_false_deletion` even if the label record has another audit-quality issue.
`critical_false_delete` is accepted as a legacy alias for `critical_keep` during label parsing; review outputs expose only normalized aggregate metrics and never echo the raw label value.

Review independently enumerates `.trimmed.jsonl` entries in the reports directory. Only regular files whose exact bytes can be read enter the actual artifact map. Its key set must exactly equal the unique output IDs declared by successful compress results: missing, stale extra, non-regular, unreadable, or duplicate-declared targets produce fixed readiness issues and keep trust `review_required`. Review also requires every expected digest to match the recomputed digest for the same ID; same-name byte drift produces `compressed_hash_mismatch`.

From the same Buffer, review independently reruns the shared source-adapter and retained-message multiset validation against the same-name current report. It exposes `structurally_valid_compressed_artifacts` and `matched_compressed_message_sets` against `expected_compressed_artifacts`. `compressed_structure_invalid`, `compressed_message_set_mismatch`, and `compressed_validation_unavailable` distinguish malformed JSONL, normalized-message drift, and an unusable report reference. Legal source metadata that the parser intentionally ignores remains permitted. Review never exposes digest values, paths, IDs, fingerprints, parser errors, or content. This validates structural readability and correspondence with recorded decisions; it does not prove that scoring decisions are safe, preserve ignored raw records byte-for-byte, or make the compressed copy safe without manual review.

It writes privacy-narrowed `trimctx.phase0.review.v2` JSON plus `phase0-review.md`. Both files are fully staged and then committed as one in-process transaction; recoverable write failures restore the previous pair, while rollback or cleanup failures report all ordered leaf causes and retain recovery artifacts. Malformed report JSON, malformed label JSON, and non-object label records fail before output commit with stable file/line diagnostics that do not echo private input or runtime parser details. Forced termination, power loss, and concurrent review writers do not have a persistent journal or coordination guarantee. Report-quality output contains aggregate counts only; neither review artifact includes invalid IDs or values, reports/labels directory paths, command errors, message content, or review notes. `phase0:review` is a repository development script; run it from a source checkout, not from a globally installed package.

## Trust Status

| Status | Meaning |
| --- | --- |
| `review_required` | Batch evidence is missing/inconsistent, has invalid input hash/boolean evidence, lacks command-input SHA-256 binding or required report/compressed integrity data, has unavailable or mismatched analyze/report semantics, has duplicate samples or artifact IDs, has report ID/hash/source/input or compressed artifact set/hash mismatch, has structurally invalid compressed JSONL, compressed/report message-set drift, or unavailable compressed semantic validation, sample or successful-report source coverage is incomplete, current reports are not `trimctx.report.v2`, report messages have gate-relevant quality issues (including a remove/compress candidate without a non-empty reasons array), labels lack valid decisions or review notes, label categories do not match referenced report decisions, label references are invalid, duplicate labels exist, decisions mismatch the report, or metrics are still null. |
| `locked` | Batch evidence is coherent, coverage and execution gates pass, report and label quality counts are zero, and all manual-review gates pass. |
| `failed` | A structurally complete batch misses an execution gate, or complete manual review misses a safety metric gate. |

## Acceptance Criteria

| Metric | Target | How to measure |
| --- | ---: | --- |
| Parser success rate | >= 95% | `analyze_ok / sample_count` in `phase0-results.json` |
| Report success rate | >= 95% | `report_ok / sample_count` in `phase0-results.json` |
| Compress success rate | >= 95% | `compress_ok / sample_count` in `phase0-results.json` |
| Input mutation | 0 files | `input_unchanged == sample_count` |
| Input evidence consistency | 100% | Every result has valid before/after SHA-256 values and `input_unchanged` equals digest equality |
| Command input SHA-256 binding | 100% | `input_sha256_bound == sample_count` in `phase0-review.json` |
| Report input binding | 100% | Every successful analyze/report declares the current batch sample's exact absolute `input.file` |
| Analyze/report semantic binding | 100% | `matched_analyze_report_semantics == expected_analyze_report_pairs` in `phase0-review.json` |
| Report artifact identity | 100% | `matched_report_hashes == expected_reports` in `phase0-review.json` |
| Report source binding | 100% | `matched_report_sources == expected_reports` and successful-report source coverage meets 2 Claude/1 OpenAI/2 Codex |
| Review input binding | 100% | `matched_report_inputs == expected_reports` in `phase0-review.json` |
| Compressed artifact set | 100% | `matched_compressed_artifacts == expected_compressed_artifacts` with no extra usable `.trimmed.jsonl` files |
| Compressed artifact identity | 100% | Every successful compress records `output_sha256` and `matched_compressed_hashes == expected_compressed_artifacts` |
| Compressed structure | 100% | `structurally_valid_compressed_artifacts == expected_compressed_artifacts` |
| Compressed decision correspondence | 100% | `matched_compressed_message_sets == expected_compressed_artifacts` |
| Aggregate consistency | 100% | `failed_samples` exactly equals the results-order recomputation and sample/output IDs are unique |
| Critical false deletion | 0 | `critical_false_deletion` in `phase0-review.json` |
| Protected recall | 100% | `protected_recall` in `phase0-review.json` |
| Remove-candidate precision | >= 70% | `remove_candidate_precision` in `phase0-review.json` |
| Trust status | `locked` | `trust_status` in `phase0-review.json` |

## Completion Checklist

- [ ] At least 5 samples were run.
- [ ] All supported source families were represented.
- [ ] No raw private JSONL files appear in `git status`.
- [ ] `phase0-results.json` is results v2, contains valid internally consistent input hashes, shows all command inputs SHA-256-bound and all inputs unchanged, accepts only analyze/reports bound to their current sample path, records analyze/report semantic evidence plus every successful report and compressed-artifact SHA-256, and remains private or fully redacted.
- [ ] `phase0-review.json` shows all expected analyze/report semantics, report IDs, hashes, sources, inputs, compressed IDs, compressed hashes, compressed structures, and retained-message sets matched, with no stale extra artifacts.
- [ ] `aggregate.failed_samples` exactly matches per-sample outcomes including analyze/report semantic status, and sample/compressed IDs are unique.
- [ ] Every `remove_candidate` and `compress_candidate` has a non-empty `reasons` array.
- [ ] Every `remove_candidate` was manually labeled.
- [ ] Protected keep examples were labeled.
- [ ] `phase0-review.json` and `phase0-review.md` were generated.
- [ ] Critical false deletions are zero.
- [ ] Protected recall is 100%.
- [ ] Remove-candidate precision is at least 70%.
- [ ] `trust_status` is `locked` before recommending compressed output as replacement context.
- [ ] Public docs do not claim Phase 0 complete unless `trust_status` is `locked`.
- [ ] Any rule changes are backed by a new unit test.
