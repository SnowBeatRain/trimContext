# Context State Goal Safety Design

## Goal

Prevent transcript-derived current-goal text from creating trimctx markers, multiline structure, unbounded content, or persisted credentials inside the Stop hook's managed `.claude/CLAUDE.md` block, without changing Report v2 resume data or any analysis behavior.

## Confirmed Data Flow And Failure

`extractResumeState()` selects a recent user segment, redacts several common secret shapes, collapses whitespace, and caps `ResumeEvidence.text` at 220 UTF-16 code units. `formatContextState()` then interpolates `report.resume.currentGoal.text` directly into the CLAUDE.md state block.

A pipeline-shaped report whose `currentGoal.text` was deliberately overridden with an inline `<!-- TRIMCTX_STATE_END -->` produced one start marker and two end markers. This proves `formatContextState()` itself does not preserve the managed-section invariant. The normal extractor currently splits at the marker's `!`, so the complete marker is not directly reachable through that specific parsing path; the final persistence formatter should not depend on this incidental upstream behavior.

The extractor does not redact authorization-header forms that the human Markdown report already treats as sensitive. A real Stop run with the bearer value before marker-like text persisted that credential into project instructions, so the sensitive-data issue is reachable through the normal pipeline.

## Approaches Considered

1. Add a final, hook-specific display sanitizer in `context-state.ts`. This is preferred because it protects the exact persistence boundary while leaving machine-readable Report v2, handoff, and new-chat evidence untouched.
2. Strengthen `resume/extractor.ts`. This would improve every consumer but intentionally change Report v2 resume fields and downstream artifacts, expanding blast radius beyond the hook write issue.
3. Reject Stop whenever current-goal text contains a marker. This avoids malformed writes but lets transcript content cause a persistent hook denial of service instead of producing a useful safe status.

## Output Contract

Before interpolating the current goal into CLAUDE.md, the formatter must:

1. Use `未识别` when the value is absent or becomes empty.
2. Redact token prefixes, credential-bearing URLs, emails, authorization bearer/basic values, generic basic credentials, and named secret assignments using the established report-display patterns.
3. Replace every exact trimctx start or end marker with `[trimctx marker omitted]`.
4. Replace ASCII control characters with spaces, collapse all whitespace runs, and trim the result so the goal occupies one Markdown line.
5. Cap the final display at 220 code units using the existing `217 + "..."` convention.

Marker neutralization occurs before truncation, guaranteeing the final value cannot contain a complete trimctx marker. Redaction occurs before truncation so a secret is not partially exposed at the length boundary.

## Scope And Ownership

The formatter remains private to `context-state.ts`. It is not a general-purpose redaction API and does not modify `ResumeState`. This avoids silently changing JSON reports or continuation artifacts while providing defense in depth at the only path that persists transcript-derived goal text into project instructions.

All numeric health, parser, readiness, reason, and recommendation fields remain unchanged. SessionStart still writes only `CLAUDE_ENV_FILE`; Stop still writes only the validated trimctx-managed CLAUDE.md range through atomic storage.

## Test Strategy

- Add a direct `formatContextState()` regression containing newlines, both trimctx markers, authorization credentials, and more than 220 characters.
- Assert a single rendered line, exactly one outer start/end marker, credential redaction, marker replacement, and a goal display length no greater than 220.
- Add an empty/whitespace goal fallback regression.
- Add a real Stop process regression using a candidate-producing transcript whose explicit goal places a bearer credential before end-marker-like text. Run Stop twice and require both runs to succeed, the stored block to contain only one marker pair, the credential to remain absent, no atomic temp files to remain, and transcript SHA-256 to stay unchanged.
- Run focused context-state/hook tests followed by the full test, build, package, and diff gates.

## Non-Goals

- No Report v2, resume extractor, handoff, or new-chat content changes.
- No general Markdown escaping or rewriting of the intended goal semantics.
- No scorer, threshold, safety, parser, compression, discovery, or public command changes.
