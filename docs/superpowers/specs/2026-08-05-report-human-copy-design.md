# Report Human Copy Design

## Goal

Improve the Chinese human-readable `analyze` summary and Markdown report without changing `trimctx.report.v2`, scoring, thresholds, findings, recommendations, or compression behavior.

## Evidence

Representative Claude Code, OpenAI, and Codex inputs currently mix Chinese labels with English assessment text. Limitation findings are also printed immediately after the same limitation, producing output such as `Assessment limitation ... - Assessment limitation ...`.

## Options Considered

1. Localize only the two human renderers. This preserves the machine contract and keeps the change reversible. Selected.
2. Change assessment and finding strings in the JSON report. This would improve consistency but silently change the automation contract.
3. Add a public language option. This expands the frozen CLI surface and is not justified during v0.2 stabilization.

## Design

Add a focused presentation-copy module that maps stable report enums and generated copy to Chinese labels. Both `src/cli/format-summary.ts` and `src/core/report-markdown.ts` use it. Unknown or externally supplied copy falls back to the original text so the renderer remains forward-compatible.

The terminal summary excludes `limitation` findings because limitations already have a dedicated section. Other findings retain their evidence and ordering but receive localized titles and summaries when their stable code is known.

The Markdown renderer localizes health status, confidence, dimension levels and summaries, finding copy, suggested actions, continuation labels, recommendations, and boolean display values. Audit identifiers such as decision values and signal codes remain unchanged where they are useful for JSON correlation.

## Safety And Compatibility

- No changes to parser, tokenizer, safety, scorer, threshold, report schema, report data, or compressor.
- No new command or option.
- JSON output remains byte-compatible for the same input and runtime.
- Human rendering continues to escape and redact the same content.
- Unknown codes and copy fall back to existing values rather than disappearing.

## Verification

- Targeted formatter tests first fail on the old mixed-language output.
- Targeted tests pass after implementation.
- Representative fixture CLI output is inspected.
- Full `npm test`, `npm run build`, `npm pack --dry-run --json`, and `git diff --check` pass.
