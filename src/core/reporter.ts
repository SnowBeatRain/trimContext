import { createAnalysisWarnings } from "./diagnostics.js";
import { createAnalysisSummary, createTokenizationSummary } from "./report-summary.js";
import { extractResumeState } from "./resume/extractor.js";
import type { AnalysisReport, AnalyzedMessage } from "../types/report.js";
import type { NormalizedMessage } from "../types/message.js";

type ReportForResume = Omit<AnalysisReport, "resume">;

export function createReport(messages: NormalizedMessage[], file: string): AnalysisReport {
  const analyzedMessages = messages.map(toAnalyzedMessage);
  // Report candidates are derived from analyzed decisions, matching the compressor's source of truth.
  const removeCandidates = analyzedMessages.filter((message) => message.decision === "remove_candidate");
  const totalTokens = analyzedMessages.reduce((sum, message) => sum + message.tokens, 0);
  const savingTokens = removeCandidates.reduce((sum, message) => sum + message.tokens, 0);
  const warnings = detectWarnings(messages);
  const reportWithoutResume: ReportForResume = {
    schema_version: "trimctx.report.v1" as const,
    input: {
      file,
      source: messages[0]?.source ?? "openai-jsonl",
      session_id: firstSessionId(messages)
    },
    summary: createAnalysisSummary(analyzedMessages, removeCandidates, totalTokens, savingTokens),
    tokenization: createTokenizationSummary(analyzedMessages),
    phase0_trust: createPhase0TrustStatus(),
    parser_diagnostics: createParserDiagnostics(analyzedMessages),
    messages: analyzedMessages,
    remove_candidates: removeCandidates,
    warnings: [...warnings, ...createAnalysisWarnings(messages)]
  };
  return {
    ...reportWithoutResume,
    resume: extractResumeState(reportWithoutResume)
  };
}

function firstSessionId(messages: NormalizedMessage[]): string | undefined {
  return messages.find((message) => typeof message.sessionId === "string" && message.sessionId.length > 0)?.sessionId;
}

function createPhase0TrustStatus(): AnalysisReport["phase0_trust"] {
  return {
    status: "review_required",
    metrics: {
      critical_false_deletion: null,
      protected_recall: null,
      remove_candidate_precision: null
    },
    gates: {
      critical_false_deletion: 0,
      protected_recall: 1,
      remove_candidate_precision: 0.7
    },
    notes: [
      "Phase 0 trust is not locked until manual labels are reviewed.",
      "remove_candidate and compress_candidate are review-only recommendations, not automatic deletion approval."
    ]
  };
}

function createParserDiagnostics(messages: AnalyzedMessage[]): AnalysisReport["parser_diagnostics"] {
  const sourceLines = messages.map((message) => message.sourceLine);
  const roleCounts: AnalysisReport["parser_diagnostics"]["role_counts"] = {};
  for (const message of messages) {
    roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
  }
  return {
    source: messages[0]?.source ?? "openai-jsonl",
    parsed_messages: messages.length,
    source_lines: {
      min: sourceLines.length > 0 ? Math.min(...sourceLines) : 0,
      max: sourceLines.length > 0 ? Math.max(...sourceLines) : 0
    },
    role_counts: roleCounts,
    empty_content_messages: messages.filter((message) => message.content.trim().length === 0).length,
    missing_timestamp_messages: messages.filter((message) => !message.timestamp).length
  };
}

function detectWarnings(messages: NormalizedMessage[]): string[] {
  const warnings: string[] = [];
  const compactSubtypes = messages.flatMap((m) => {
    const raw = m.raw as Record<string, unknown> | undefined;
    if (!raw || raw.type !== "system") return [];
    return raw.subtype === "away_summary" || raw.subtype === "compact_boundary" ? [String(raw.subtype)] : [];
  });

  if (compactSubtypes.length > 0) {
    const uniqueSubtypes = [...new Set(compactSubtypes)].sort();
    warnings.push(
      `session_compacted: ${compactSubtypes.length} compact event(s) detected (${uniqueSubtypes.join(", ")}) — conversation was previously compressed`
    );
  }
  return warnings;
}

function toAnalyzedMessage(message: NormalizedMessage): AnalyzedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    source: message.source,
    sourceLine: message.sourceLine,
    tokens: message.tokens ?? 0,
    token_metadata: message.token_metadata,
    protected: Boolean(message.protected),
    rot_score: message.rot_score ?? message.scores?.rot_score ?? 0,
    scores:
      message.scores ?? {
        superseded_score: 0,
        low_reference_score: 0,
        age_score: 0,
        redundancy_score: 0,
        orphan_tool_score: 0,
        low_value_score: 0,
        rot_score: 0
      },
    decision: message.decision ?? "keep",
    reasons: message.reasons ?? [],
    timestamp: message.timestamp,
    sessionId: message.sessionId
  };
}
