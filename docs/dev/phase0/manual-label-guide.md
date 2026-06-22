# Phase 0 Manual Label Guide

Use this guide to review trimctx output on private real-world sessions. Do not commit raw sessions, generated reports, or filled private labels.

## Prepare

Run the batch validator:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

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
```

Phase 0 should not pass if `critical_false_deletion > 0`, even when aggregate precision is high. `questionable_remove` does not count as safe for precision.

## Review Aggregation

After labels are filled, run:

```bash
npm run --silent phase0:review -- --reports reports/phase0 --labels datasets/private/phase0-labels --out reports/phase0
```

The script writes:

- `reports/phase0/phase0-review.json`
- `reports/phase0/phase0-review.md`

The review status is:

- `review_required` when labels are missing, label references are invalid, duplicate labels exist, decisions mismatch the report, or metrics are incomplete
- `locked` when all labels are valid and all gates pass
- `failed` when review ran with valid labels but at least one metric gate failed

## Tuning Loop

If a critical false deletion or suspicious questionable removal appears:

1. Copy only a redacted minimal fixture into `tests/fixtures/`.
2. Add a unit test that reproduces the unsafe candidate.
3. Update safety/scoring rules.
4. Re-run `npm test`, `npm run build`, Phase 0 validation, and `phase0:review`.
