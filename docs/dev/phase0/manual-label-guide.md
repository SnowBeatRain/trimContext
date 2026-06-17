# Phase 0 Manual Label Guide

Use this guide to review trimctx output on private real-world sessions. Do not commit raw sessions, generated reports, or filled private labels.

## Prepare

Run the batch validator:

```bash
npm run --silent phase0:run -- --dir datasets/private/phase0 --out reports/phase0
```

For each generated `*.report.json`, inspect `remove_candidates` first. If a sample has no remove candidates, still inspect warnings and protected-message counts.

## Labels

Assign one label to each remove candidate.

| Label | Meaning |
| --- | --- |
| `safe_remove` | Clearly obsolete, duplicated, superseded, low-value, or orphaned. Removing it should not harm future context. |
| `unsafe_remove` | Contains still-relevant user intent, current instructions, credentials handling guidance, unresolved decisions, or context needed by later messages. |
| `uncertain` | Human reviewer cannot confidently decide without replaying more context. Count as not safe for precision. |

## Review Fields

Record these fields in your private label file:

- sample filename
- source type
- message id
- source line
- role
- decision
- reasons
- rot score
- label
- short rationale

## Critical False Deletion Rules

Mark a candidate as `unsafe_remove` immediately if it contains any of the following:

- latest user requirement or correction
- active task state
- system/developer instruction
- security or privacy constraint
- API contract or schema decision still used later
- tool result required to understand a later assistant response
- unresolved error, blocker, or diagnostic clue

## Metric Formulas

```text
remove_candidate_precision = safe_remove / (safe_remove + unsafe_remove + uncertain)
critical_false_deletion = count(unsafe_remove where severity is critical)
protected_recall = protected_should_keep / total_should_keep_sensitive_messages
```

Phase 0 should not pass if `critical_false_deletion > 0`, even when aggregate precision is high.

## Tuning Loop

If a false deletion appears:

1. Copy only a redacted minimal fixture into `tests/fixtures/`.
2. Add a unit test that reproduces the unsafe candidate.
3. Update safety/scoring rules.
4. Re-run `npm test`, `npm run build`, and Phase 0 validation.
