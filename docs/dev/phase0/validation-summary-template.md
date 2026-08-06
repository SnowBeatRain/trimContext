# Phase 0 Validation Summary

Copy this template when a validation round is complete. Keep raw reports and filled private labels out of git unless they have been fully sanitized. Treat `phase0-results.json` as private by default because it can include local paths, `stderr`, and `error` details.

## Run Metadata

- Date:
- trimctx version:
- Commit or branch:
- Command:
- Input directory:
- Output directory:

## Sample Overview

| Sample | Source | Messages | Tokens | Remove candidates | Compress candidates | Warnings | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
|  |  |  |  |  |  |  |  |

## Acceptance Metrics

| Metric | Target | Actual | Pass? | Notes |
| --- | ---: | ---: | --- | --- |
| Parser success rate | >= 95% |  |  |  |
| Report success rate | >= 95% |  |  |  |
| Compress success rate | >= 95% |  |  |  |
| Input mutation | 0 |  |  |  |
| Critical false deletion | 0 |  |  |  |
| Protected recall | 100% |  |  |  |
| Remove-candidate precision | >= 70% |  |  |  |

## Manual Review Counts

| Label or metric | Count | Notes |
| --- | ---: | --- |
| `safe_remove` |  |  |
| `questionable_remove` |  |  |
| `critical_keep` |  |  |
| `protected_keep` |  |  |
| Protected reviewed |  |  |
| Critical protected reviewed |  |  |
| Non-critical protected reviewed |  |  |
| Protected sample coverage |  |  |
| Protected review requirement met |  |  |
| `over_protected` |  |  |
| `missed_low_value_noise` |  |  |
| `needs_summary` |  | Non-locking evidence; excluded from precision/recall/coverage denominators. |
| `unclear` |  | Non-locking evidence; excluded from precision/recall/coverage denominators. |

## False Positives

List candidates trimctx wanted to remove but reviewers rejected.

| Sample | Message id | Source line | Reason | Why unsafe |
| --- | --- | ---: | --- | --- |
|  |  |  |  |  |

## False Negatives

List obviously stale or low-value content trimctx failed to flag.

| Sample | Message id | Source line | Why it should be removable |
| --- | --- | ---: | --- |
|  |  |  |  |

## Decision

- [ ] Phase 0 passes; proceed to next release/readiness step.
- [ ] Phase 0 needs tuning before release.

## Follow-up Changes

-
