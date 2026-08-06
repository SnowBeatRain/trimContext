# Resume Evidence Trust Boundaries Design

## Problem

Representative Report v2 audits exposed a systematic continuation-quality issue. Four read-only Claude Code/Codex reports were generated under the ignored `tmp-real-validation/` directory with input hashes unchanged. The report structure and candidate invariants were valid, but continuation evidence crossed semantic boundaries:

- both Claude reports selected `tool_result` records as the current goal;
- all six reported decisions in both Claude reports came from `tool_result` records;
- active-file lists were dominated by paths copied from tool-result bodies;
- tool containers inherited the normalized `user` or `assistant` role and therefore received high or medium resume confidence;
- low-confidence tool-only evidence could satisfy a weighted readiness signal as fully as conversational evidence.

The result can overstate continuation readiness and place tool output or code fragments into Report v2 and new-chat goal/decision sections. This does not affect scorer or compression decisions, but it weakens the report-quality mainline.

## Options

### Reject all tool evidence

This prevents false goals but also removes useful test output and failed-command evidence. It is too broad for continuation artifacts.

### Adjust readiness scoring only

This can lower the readiness label, but invalid goal and decision evidence would remain in Report v2, handoff, and next-context artifacts. It treats the symptom rather than the source boundary.

### Apply evidence-category trust boundaries

This is the selected approach. Each resume category accepts only the sources appropriate to its semantics:

- current goal, decisions, and next steps use conversational user/assistant bodies only;
- metadata, `tool_use`, and `tool_result` containers cannot supply conversational evidence even when an adapter normalizes their outer role as `user` or `assistant`;
- active files use conversational bodies plus `tool_use`, because an invoked path is relevant, but exclude broad `tool_result` bodies;
- failures and test signals retain tool evidence for diagnostic value;
- `tool_use` and `tool_result` resume evidence always has low confidence regardless of its normalized outer role;
- readiness weights count only evidence above low confidence.

An actual user body remains eligible even when its coarse analysis kind is `test_or_error`; the exclusion targets container semantics, not topic classification.

## Compatibility

The Report v2 schema, field order, message analysis, safety rules, scorer, thresholds, candidate decisions, review queue, recommendations API, new-chat file set, and compression behavior remain unchanged. Existing evidence can become absent or lower-confidence when it came only from an untrusted container, so readiness may conservatively move from `ready` to `partial` or `blocked`.

Failures and test signals continue to expose tool-derived evidence for review. The change does not redact or rewrite transcript content and does not modify input files.

## Testing

- Reproduce a Claude-style user-wrapped `tool_result` containing fake goal, decision, path, failure, and test text.
- Require goal and decision extraction to ignore the wrapper while retaining an actual conversational goal.
- Require active files to reject tool-result paths but retain a tool-use path with low confidence.
- Require failure/test evidence from tool containers to remain available with low confidence.
- Require readiness to ignore low-confidence-only signals.
- Run resume/report/new-chat focused tests, then regenerate representative real reports and inspect origin kinds without outputting message content.
- Run the complete test, build, package, diff, and residue gates.
