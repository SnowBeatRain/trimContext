# trimctx Manual Review Rubric

This rubric is used to review `remove_candidate`, `compress_candidate`, and protected high-rot messages before changing defaults or trusting a compressed artifact.

## Labels

| Label | Meaning | Action |
| --- | --- | --- |
| `safe_remove` | The message is stale, duplicated, superseded, or low-value, and removing it does not break task continuity. | Can support future threshold tuning after enough agreement. |
| `critical_false_delete` | The message contains requirements, constraints, decisions, code, commands, failures, credentials placeholders, or context needed later. | Must remain protected; treat as a blocking safety finding. |
| `over_protected` | The message is protected by a conservative rule but appears safe to remove or summarize. | Use only as tuning evidence; do not remove automatically. |
| `needs_summary` | The content is too valuable to delete but too large/noisy to keep verbatim. | Candidate for future summarization, not current compression deletion. |
| `unclear` | Reviewer cannot decide from report metadata alone. | Inspect source privately or keep by default. |

## Required Review Fields

For every reviewed candidate, record:

- `sample_id`: Private sample alias, not the raw path if it leaks local context.
- `source_line`: JSONL source line from the report.
- `decision`: Original trimctx decision.
- `rot_score`: Reported score.
- `label`: One of the labels above.
- `review_note`: Short explanation without raw secrets or long message content.

## Review Rules

- Prefer `unclear` or `critical_false_delete` over optimistic deletion when evidence is incomplete.
- Never paste raw credentials, tokens, passwords, private keys, or connection strings into review notes; write `[REDACTED]`.
- Treat system/developer instructions, user decisions, architecture/API decisions, shell commands, git diffs, stack traces, and test failures as high-risk by default.
- A default threshold or weight change requires reviewed evidence across multiple samples, not one anecdote.
- `compress_candidate` is report-only in the current product and must not be counted as removed content.

## Minimal Acceptance Counts Before Tuning

Before proposing default scorer changes, collect at least:

- 30 reviewed `remove_candidate` or near-threshold messages.
- 10 reviewed protected high-rot messages.
- 0 unresolved `critical_false_delete` findings for the proposed change.
- A written summary explaining expected false-positive and false-negative tradeoffs.

## Example Row

| sample_id | source_line | decision | rot_score | label | review_note |
| --- | ---: | --- | ---: | --- | --- |
| private-a | 42 | compress_candidate | 0.6428 | needs_summary | Large tool output is noisy but may explain later debugging context. |
