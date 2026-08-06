# Phase 0 Manual Label Guide

Use this guide to review trimctx output on private real-world sessions. Do not commit raw sessions, generated reports, or filled private labels.

## Prepare

Run the batch validator:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

Keep `--dir` and `--out` as different real directories. Before the batch starts, the runner also requires every input basename to produce a unique sample ID after unsupported-character replacement and the 120-character limit; Windows also rejects IDs that differ only by case. If it reports a collision, rename one private input and rerun; no output directory or partial report has been created by that failed attempt.

For each generated `*.report.json`, inspect `remove_candidates` first. If a sample has no remove candidates, still inspect warnings, protected-message counts, and representative protected examples.

## Label Files

Store labels as JSONL under a private gitignored directory, for example `datasets/private/phase0-labels/`. One JSON object represents one reviewed message.

Required fields:

- `sample_id`
- `message_id`
- `decision`
- `label`
- `review_note`

Useful optional fields:

- `source`
- `source_line`
- `rot_score`

Example:

```jsonl
{"sample_id":"sample-a","message_id":"msg-12","decision":"remove_candidate","label":"safe_remove","review_note":"obsolete duplicated tool output"}
{"sample_id":"sample-a","message_id":"msg-31","decision":"keep_protected","label":"protected_keep","review_note":"latest user correction"}
```

## Labels

Assign one label to each reviewed candidate or protected example.

| Label | Meaning |
| --- | --- |
| `safe_remove` | A `remove_candidate` is clearly obsolete, duplicated, superseded, low-value, or orphaned. Removing it should not harm future context. |
| `questionable_remove` | A candidate might be removable, but the reviewer is not confident enough to count it as safe. |
| `critical_keep` | A candidate actually contains context that must be kept. This counts as a critical false deletion. |
| `protected_keep` | A protected message is correctly protected and should remain available. |
| `over_protected` | A protected message appears over-protected or lower value than the rule suggests. |
| `missed_low_value_noise` | Low-value noise was not surfaced as a candidate and should inform future tuning. |
| `needs_summary` | A non-remove message is valuable enough to keep but too large or noisy to keep verbatim in a future summarization path. |
| `unclear` | The reviewer cannot decide from report metadata alone; inspect the private source or keep by default. |

`critical_false_delete` is accepted as a legacy alias for `critical_keep`, but new label files should use `critical_keep`.

Label categories must match the report decision they review:

- `safe_remove`, `questionable_remove`, and `critical_keep` are valid only for `remove_candidate`.
- `protected_keep` and `over_protected` are valid only for protected messages.
- `missed_low_value_noise` is valid only for unprotected non-remove messages, including kept messages and report-only `compress_candidate` messages.
- `needs_summary` is valid only for non-remove messages, including report-only `compress_candidate`, kept, or protected messages.
- `unclear` is valid for any reviewed report message.

`phase0:review` counts category mismatches as `incompatible_label_categories` and keeps trust `review_required`. Review artifacts expose only aggregate counts, not the mismatched message ID, label value, or review note.

`needs_summary` and `unclear` are non-locking evidence labels. They are accepted and reported as aggregate counts, but they do not satisfy required remove-candidate review, protected review, precision, recall, or protected-coverage denominators.

## Critical False Deletion Rules

Mark a `remove_candidate` as `critical_keep` immediately if it contains any of the following:

- latest user requirement or correction
- active task state
- system/developer instruction
- security or privacy constraint
- API contract or schema decision still used later
- tool result required to understand a later assistant response
- unresolved error, blocker, or diagnostic clue

## Metric Formulas

```text
remove_candidate_precision = safe_remove / reviewed_remove_candidates
critical_false_deletion = count(remove_candidate labels where label == critical_keep)
protected_recall = protected_keep / reviewed_protected_examples
protected_sample_coverage = reviewed_non_critical_protected / non_critical_protected
```

`reviewed_remove_candidates`, `reviewed_protected_examples`, and protected coverage denominators count only effective locking labels: the referenced message has exactly one label, the label has a valid `decision` matching the report, the category is compatible with that message, `review_note` is non-empty, and the label belongs to the relevant locking class. `needs_summary` and `unclear` remain visible as aggregate evidence but are excluded from these denominators. `critical_keep` on a `remove_candidate` is still counted conservatively as `critical_false_deletion` even if the label record has a separate audit-quality issue.

Critical protected messages are protected messages with `rot_score >= 0.6`, matching the protected-high-rot queue that Phase 0 reviewers must inspect because these messages are protected yet look stale or noisy. Phase 0 requires all critical protected messages to be labeled, while other protected messages only need representative sampling. The default non-critical protected sample gate is `20%`.

Phase 0 should not pass if `critical_false_deletion > 0`, even when aggregate precision is high. `questionable_remove` does not count as safe for precision.

## Review Aggregation

After labels are filled, run:

```bash
npm run --silent phase0:review -- --reports reports/phase0 --labels datasets/private/phase0-labels --out reports/phase0
```

The script writes:

- `reports/phase0/phase0-review.json`
- `reports/phase0/phase0-review.md`

The script also reads `reports/phase0/phase0-results.json` automatically. Current evidence must use `trimctx.phase0.results.v2`. Every result needs a unique sample path plus valid lowercase before/after input SHA-256 values, and `input_unchanged` must equal whether those digests match; a coherent difference remains `input_mutation_detected`, while contradictory fields are invalid evidence. Every fresh sample also records `input_sha256_bound:true`: the runner passed the initial digest to analyze/report/compress, and each command validated the exact Buffer it parsed. Review exposes only the aggregate `input_sha256_bound` count. Older v2 without the sample or aggregate binding evidence produces `input_sha256_binding_unavailable`; malformed present evidence is invalid and a coherent aggregate drift remains `aggregate_mismatch`. `aggregate.failed_samples` must exactly equal the results-order recomputation from analyze/report semantics, command outcomes, and input integrity. Before a Phase 0 analyze or report can count as successful, its valid Report v2 `input.file` must exactly match the absolute path passed for the current batch sample; a mismatched declared path is not copied into evidence, and a mismatched report receives no digest. When that report is valid, a successful compress result additionally means the output was re-read through its declared source adapter and its normalized-message multiset matched the report after excluding `remove_candidate`; malformed JSONL, message drift, or unusable message identities turn only that command result into a fixed privacy-safe failure. Every newly successful compress result records `output_sha256`. Review recomputes report and compressed-artifact digests, then requires successful report IDs, hashes, sources and inputs plus compressed IDs and hashes to match batch evidence. The 2 Claude/1 OpenAI/2 Codex coverage gate counts actual supported sources only for expected successful reports. A changed report produces `report_hash_mismatch`; a changed same-name compressed artifact produces `compressed_hash_mismatch`; a source disagreement produces `report_source_mismatch`; a sample/report input disagreement produces `report_input_mismatch`. Legacy results v1 produces `report_integrity_unavailable`; older valid results v2 with a missing successful-compress digest produces `compressed_integrity_unavailable`; both require a fresh batch. A malformed present digest is invalid evidence. Review does not reopen original transcripts, which may legitimately move or grow after the batch. The script also retains all existing report-message and label-quality checks, including label decision validity, non-empty review notes, label uniqueness per message, and label category compatibility with the referenced report message. Human-review precision/recall metrics count only effective locking labels, while `needs_summary` and `unclear` remain non-locking aggregate evidence and critical false deletion remains conservatively counted from `critical_keep` labels on remove candidates. Missing, inconsistent, or incomplete batch evidence remains `review_required`; a complete batch that misses an execution gate is `failed`.

Every fresh result also records whether the complete parsed `analyze --json` and JSON report values matched, plus a private canonical analyze SHA-256 when both commands succeeded. Canonicalization ignores formatting and object-key order but preserves arrays and all values; no Report v2 field is excluded. Review recomputes the current report semantic digest and exposes only `expected_analyze_report_pairs` and `matched_analyze_report_semantics`. A mismatch produces `analyze_report_semantic_mismatch`; older v2 evidence without the new field produces `analyze_report_semantic_validation_unavailable` and must be regenerated. Malformed present status, digest, or aggregate evidence remains invalid. This proves the two command paths correspond, not that their shared report decisions are safe.

Review also enumerates the current reports directory and requires the readable regular `.trimmed.jsonl` ID set to exactly match the unique targets declared by successful compress results. It hashes the exact bytes read and requires those digests to match results v2. From the same Buffer it independently re-parses each expected artifact with the current same-name report's source adapter and compares normalized identity multisets using source, role, content, optional timestamp, optional session ID, and duplicate counts. IDs and source lines are intentionally excluded because Codex line removal and OpenAI batch removal can renumber them. `compressed_structure_invalid`, `compressed_message_set_mismatch`, and `compressed_validation_unavailable` keep trust `review_required`; the aggregate fields are `structurally_valid_compressed_artifacts` and `matched_compressed_message_sets`. Missing, stale extra, non-regular, unreadable, duplicate-declared, missing-integrity, or same-name changed artifacts remain independently classified. Review artifacts expose only matched/expected counts and fixed issue codes; digests, paths, IDs, fingerprints, parser errors, and content stay private. Passing this gate proves adapter readability and agreement with recorded decisions, not that the decisions are safe or that Phase 0 is locked.

`phase0-review.json` now uses `trimctx.phase0.review.v2`. The JSON and Markdown outputs are written through one in-process transaction: both are staged before either target changes, and recoverable commit failures restore the previous pair. Rollback or cleanup failures preserve all ordered leaf causes and leave recovery artifacts for inspection. Malformed report JSON, malformed label JSON, and non-object label records stop before output commit with stable file/line diagnostics that do not echo private input or runtime parser details. Forced termination, power loss, and concurrent writers are not covered by a persistent journal or lock. The v2 review outputs keep aggregate validation, report/hash/source/input match counts, report-quality metrics, and fixed issue codes, but omit digest values, input paths, invalid source values, invalid IDs or field values, the reports/labels directory paths, command errors, raw message content, and review notes. The source `phase0-results.json` remains private and retains the detailed paths and report digests needed for local audit. SHA-256 detects evidence/report drift but is not a digital signature; a party able to rewrite all related artifacts can also recompute it.

The review status is:

- `review_required` when batch evidence or coverage is incomplete, command-input SHA-256 binding is unavailable, analyze/report semantics are missing or mismatched, samples or successful artifact IDs are duplicated, report/compressed artifact sets or hashes do not match, compressed JSONL is structurally invalid, compressed/report normalized message sets differ, compressed semantic validation is unavailable, required artifact integrity evidence is absent, any current report is not `trimctx.report.v2`, report quality is non-zero, labels lack valid decisions or review notes, label categories do not match referenced report decisions, label references are invalid, duplicate labels exist, decisions mismatch the report, or metrics are incomplete
- `locked` only when batch execution/coverage, report and label quality, and manual review gates all pass
- `failed` when a complete batch misses an execution gate or complete manual review misses a safety metric gate

## Tuning Loop

If a critical false deletion or suspicious questionable removal appears:

1. Copy only a redacted minimal fixture into `tests/fixtures/`.
2. Add a unit test that reproduces the unsafe candidate.
3. Update safety/scoring rules.
4. Re-run `npm test`, `npm run build`, Phase 0 validation, and `phase0:review`.
