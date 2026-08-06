# Report v2 Continuation Recommendation Evidence Design

## Background

`resume.readiness.missing` already records the exact continuation evidence gaps, but `createRecommendations()` receives only the readiness level. Every non-ready report therefore emits the fixed machine summary `Clarify the current goal and next step before continuing.` Human renderers map the recommendation code to the same fixed Chinese meaning.

This is observably inaccurate. In the representative `claude-museum` report, the current goal is present and the actual gaps are `active files` plus `next steps`; the recommendation still asks the user to clarify the current goal. A partial readiness state can also have both a trusted goal and next step while missing decisions, files, and test signals.

## Goals

- Bind `clarify_continuation` to the exact existing `resume.readiness.missing` list.
- Make both JSON summary text and Chinese terminal/Markdown text name only the actual gaps.
- Keep recommendation code, priority, ordering, and optional command behavior stable.
- Preserve Report v2 fields, readiness weights, extraction, scoring, safety, compression, and the six-command public CLI.

## Non-goals

- Do not add a `missing_evidence` field to `Recommendation`.
- Do not change readiness thresholds, required signals, or confidence rules.
- Do not change how goals, decisions, files, tests, or next steps are extracted.
- Do not change candidate decisions or compression output.

## Approaches Considered

### Generic recommendation copy

Replace the fixed text with `Add missing continuation evidence before continuing.` This is accurate but makes the JSON recommendation less actionable even though the exact list is already available.

### Add structured recommendation details

Add `missing_evidence` to `Recommendation`. This is explicit but expands the Report v2 shape for data that already exists under `resume.readiness.missing`.

### Derive recommendation copy from readiness

Adopt this approach. Pass the complete readiness object into `createRecommendations()`, build the English machine summary from `readiness.missing`, and pass the same missing list to the shared Chinese copy helper. This preserves the schema and makes both presentation layers evidence-aligned.

## Design

`createRecommendations()` changes its third parameter from the readiness level to `AnalysisReport["resume"]["readiness"]`. For a non-ready state it produces:

```text
Add missing continuation evidence before continuing: active files, next steps.
```

If a malformed caller supplies a non-ready level with an empty missing list, the fallback remains the accurate generic sentence `Add missing continuation evidence before continuing.` No private message content enters this text because missing values come from the fixed readiness-label set.

`recommendationSummaryLabel()` accepts an optional missing-evidence list. For `clarify_continuation`, renderers pass `report.resume.readiness.missing` and receive:

```text
继续会话前，补充缺失的活跃文件、下一步。
```

Other recommendation codes retain their current fixed Chinese copy. Unknown future missing labels continue through the existing fallback used by `missingEvidenceLabel()`.

## Data Flow

1. `extractResumeState()` computes readiness and its missing list unchanged.
2. `createReport()` passes the complete readiness object to `createRecommendations()`.
3. The JSON recommendation summary is generated from that list.
4. CLI and Markdown renderers pass the same list to `recommendationSummaryLabel()`.
5. Both renderers continue to show the dedicated missing-evidence line as an independent audit signal.

## Error And Privacy Boundaries

No new filesystem or runtime error path is introduced. Recommendation construction remains total for all valid Report v2 readiness values. The generated copy contains only fixed evidence-category labels, never transcript text, paths, IDs, commands, or review notes.

## Test Strategy

- Direct constructor regression: a partial state with goal and next step present but decisions/files/tests missing must name only those three gaps and must not mention goal or next step.
- Facade regression: `createReport()` recommendations must equal a direct constructor call using the whole readiness object.
- CLI and Markdown regressions: localized recommendation text must enumerate the fixture's actual missing list.
- Representative private-report audit: recompute recommendation copy from the stored readiness only, without rewriting the private report or transcript, and confirm the recommendation no longer names present evidence.
- Run focused tests, the full suite, build, package-content smoke, dry-run package inspection, and `git diff --check`.

## Success Criteria

- `clarify_continuation` never names a continuation category that is not in `readiness.missing`.
- JSON and Chinese human output agree on the missing categories.
- Recommendation ordering and all non-clarify recommendation output remain unchanged.
- No schema, scorer, threshold, safety, compression, public-command, or transcript mutation occurs.
