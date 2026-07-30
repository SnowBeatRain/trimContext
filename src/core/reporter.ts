import { createAnalysisWarnings } from "./diagnostics.js";
import { createAnalysisMeta, createAnalysisSummary, createTokenizationSummary } from "./report-summary.js";
import { extractResumeState } from "./resume/extractor.js";
import { createAssessment } from "./assessment.js";
import { resolveAnalysisOptions, type AnalysisOptions } from "./options.js";
import type {
  AnalysisReport,
  AnalyzedMessage,
  CandidateGroup,
  Finding,
  FindingEvidenceRef,
  Recommendation,
  ReviewQueueItem
} from "../types/report.js";
import type { NormalizedMessage } from "../types/message.js";
import type { MessageAnalysisContext, SignalCode } from "../types/signals.js";
import { isCompactBoundaryMessage } from "./signals/context.js";

const GROUP_TYPES: Partial<Record<FindingEvidenceRef["code"], CandidateGroup["type"]>> = {
  superseded: "superseded",
  exact_duplicate: "duplicate",
  similar_duplicate: "duplicate",
  orphan_tool_result: "tool",
  obsolete_tool_output: "tool",
  low_value_metadata: "metadata"
};
const DECISIVE_CODES = new Set<SignalCode>([
  "low_value_metadata",
  "exact_duplicate",
  "superseded",
  "obsolete_tool_output",
  "similar_duplicate",
  "orphan_tool_result"
]);

export function createReport(messages: NormalizedMessage[], file: string, options: AnalysisOptions = {}): AnalysisReport {
  const analyzedMessages = messages.map(toAnalyzedMessage);
  const removeCandidates = analyzedMessages.filter((message) => message.decision === "remove_candidate");
  const compressCandidates = analyzedMessages.filter((message) => message.decision === "compress_candidate");
  const totalTokens = analyzedMessages.reduce((sum, message) => sum + message.tokens, 0);
  const savingTokens = removeCandidates.reduce((sum, message) => sum + message.tokens, 0);
  const warnings = detectWarnings(messages);
  const allWarnings = [...warnings, ...createAnalysisWarnings(messages)];
  const resume = extractResumeState({ messages: analyzedMessages });
  const candidateGroups = createCandidateGroups(analyzedMessages);
  const assessment = createAssessment(analyzedMessages, resume, allWarnings);
  const findings = createFindings(candidateGroups, assessment.limitations, totalTokens);
  const reviewQueue = createReviewQueue(analyzedMessages);
  const recommendations = createRecommendations(file, assessment.status, resume.readiness.level, removeCandidates.length);
  const summary = createAnalysisSummary(analyzedMessages, removeCandidates, totalTokens, savingTokens);
  const tokenization = createTokenizationSummary(analyzedMessages);
  const analysisMeta = createAnalysisMeta(tokenization, assessment, resolveAnalysisOptions(options));

  return {
    schema_version: "trimctx.report.v2",
    input: {
      file,
      source: messages[0]?.source ?? "openai-jsonl",
      session_id: firstSessionId(messages)
    },
    summary,
    tokenization,
    phase0_trust: createPhase0TrustStatus(),
    parser_diagnostics: createParserDiagnostics(analyzedMessages),
    resume,
    assessment,
    findings,
    review_queue: { items: reviewQueue },
    candidate_groups: candidateGroups,
    compress_candidates: compressCandidates,
    recommendations,
    analysis_meta: analysisMeta,
    messages: analyzedMessages,
    remove_candidates: removeCandidates,
    warnings: allWarnings
  };
}

function createCandidateGroups(messages: AnalyzedMessage[]): CandidateGroup[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const groups = new Map<string, { code: CandidateGroup["code"]; type: CandidateGroup["type"]; related?: string; entries: FindingEvidenceRef[] }>();
  for (const message of [...messages].sort((left, right) => left.sourceLine - right.sourceLine)) {
    for (const item of message.analysis.evidence) {
      const type = GROUP_TYPES[item.code];
      if (!type) continue;
      const key = `${item.code}:${item.related_message_id ?? "none"}`;
      const group = groups.get(key) ?? { code: item.code, type, related: item.related_message_id, entries: [] };
      group.entries.push(toEvidenceRef(item));
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([id, group]) => {
    const entries = [...group.entries].sort((left, right) => left.source_line - right.source_line || left.message_id.localeCompare(right.message_id));
    const memberIds = [...new Set(entries.map((entry) => entry.message_id))];
    return {
      id,
      type: group.type,
      code: group.code,
      ...(group.related ? { related_message_id: group.related } : {}),
      canonical_message_id: group.related && byId.has(group.related) ? group.related : memberIds[0]!,
      member_message_ids: memberIds,
      tokens: memberIds.reduce((sum, messageId) => sum + (byId.get(messageId)?.tokens ?? 0), 0),
      evidence: entries
    };
  }).sort((left, right) => firstGroupLine(left) - firstGroupLine(right) || left.id.localeCompare(right.id));
}

function createFindings(groups: CandidateGroup[], limitations: string[], totalTokens: number): Finding[] {
  const groupFindings: Finding[] = groups.map((group) => {
    const confidence = highestConfidence(group.evidence.map((entry) => entry.confidence));
    return {
      id: `group:${group.id}`,
      type: group.type,
      severity: confidence === "high" ? "critical" : "warning",
      confidence,
      code: group.code,
      title: `${titleCase(group.type)} context evidence`,
      explanation: `${group.code} evidence groups related messages for human review.`,
      summary: `${group.member_message_ids.length} message(s) grouped by ${group.code}.`,
      impact: {
        message_count: group.member_message_ids.length,
        tokens: group.tokens,
        token_ratio: ratio(group.tokens, totalTokens)
      },
      suggested_action: suggestedAction(group.type),
      tokens: group.tokens,
      evidence: group.evidence
    };
  });
  const limitationFindings: Finding[] = limitations.map((limitation) => ({
    id: `limitation:${limitation}`,
    type: "limitation",
    severity: "info",
    confidence: "low",
    code: limitation,
    title: `Assessment limitation: ${limitation}`,
    explanation: "Coverage limits the confidence of the overall health assessment.",
    summary: `Assessment limitation: ${limitation}.`,
    impact: { message_count: 0, tokens: 0, token_ratio: 0 },
    suggested_action: "collect_more_evidence",
    tokens: 0,
    evidence: []
  }));
  return [...groupFindings, ...limitationFindings];
}

function createReviewQueue(messages: AnalyzedMessage[]): ReviewQueueItem[] {
  return messages
    .filter((message) => message.decision === "remove_candidate"
      || message.decision === "compress_candidate"
      || (message.protected && message.rot_score >= 0.6))
    .map((message) => {
      const evidence = message.analysis.evidence.map(toEvidenceRef);
      if (message.decision === "remove_candidate") {
        if (message.protected) {
          throw new Error(`remove_candidate ${message.id} must not be protected`);
        }
        if (message.reasons.length === 0) {
          throw new Error(`remove_candidate ${message.id} must have at least one reason`);
        }
        if (!evidence.some((entry) => entry.confidence === "high" && DECISIVE_CODES.has(entry.code as SignalCode))) {
          throw new Error(`remove_candidate ${message.id} has no high-confidence decisive evidence`);
        }
      }
      const confidence = highestConfidence(evidence.map((entry) => entry.confidence));
      return {
        message_id: message.id,
        source_line: message.sourceLine,
        role: message.role,
        decision: message.decision,
        protected: message.protected,
        tokens: message.tokens,
        risk: message.decision === "remove_candidate" ? "high" : message.decision === "compress_candidate" ? "medium" : "low",
        confidence,
        reasons: message.reasons,
        evidence,
        summary: summarize(message.content),
        default_action: message.protected
          ? "keep_and_review"
          : message.decision === "remove_candidate" ? "remove_after_review" : "compress_after_review"
      } satisfies ReviewQueueItem;
    })
    .sort((left, right) => riskRank(right.risk) - riskRank(left.risk)
      || confidenceRank(right.confidence) - confidenceRank(left.confidence)
      || right.tokens - left.tokens
      || left.source_line - right.source_line
      || left.message_id.localeCompare(right.message_id));
}

function createRecommendations(
  file: string,
  health: AnalysisReport["assessment"]["status"],
  readiness: AnalysisReport["resume"]["readiness"]["level"],
  removeCount: number
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  if (health === "unknown") recommendations.push({
    code: "write_report",
    priority: 1,
    summary: "Write the full JSON report before drawing a health conclusion.",
    command: `trimctx report ${quotePath(file)} -o report.json`
  });
  if (readiness !== "ready") recommendations.push({
    code: "clarify_continuation",
    priority: 2,
    summary: "Clarify the current goal and next step before continuing."
  });
  if (health === "degraded" && readiness !== "blocked") recommendations.push({
    code: "new_chat",
    priority: 3,
    summary: "Prepare a reviewed continuation package for a new chat.",
    command: `trimctx new-chat ${quotePath(file)}`
  });
  if (removeCount > 0) recommendations.push({
    code: "review_then_compress",
    priority: 4,
    summary: "Review remove candidates before writing a compressed copy.",
    command: `trimctx compress ${quotePath(file)} -o trimmed.jsonl`
  });
  return recommendations;
}

function toEvidenceRef(item: AnalyzedMessage["analysis"]["evidence"][number]): FindingEvidenceRef {
  return {
    message_id: item.message_id,
    source_line: item.source_line,
    role: item.role,
    code: item.code,
    confidence: item.confidence,
    ...(item.related_message_id ? { related_message_id: item.related_message_id } : {})
  };
}

function firstGroupLine(group: CandidateGroup): number {
  return group.evidence[0]?.source_line ?? Number.MAX_SAFE_INTEGER;
}

function highestConfidence(values: FindingEvidenceRef["confidence"][]): FindingEvidenceRef["confidence"] {
  return values.sort((left, right) => confidenceRank(right) - confidenceRank(left))[0] ?? "medium";
}

function confidenceRank(value: FindingEvidenceRef["confidence"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function riskRank(value: ReviewQueueItem["risk"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function suggestedAction(type: CandidateGroup["type"]): Finding["suggested_action"] {
  if (type === "superseded") return "review_superseded_context";
  if (type === "duplicate") return "keep_canonical_message";
  if (type === "tool") return "review_tool_evidence";
  return "review_metadata";
}

function titleCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function summarize(content: string): string {
  const redacted = content
    .replace(/\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length <= 160 ? redacted : `${redacted.slice(0, 157)}...`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
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
    if (!raw || !isCompactBoundaryMessage(m)) return [];
    if (raw.type === "compacted") return ["compacted"];
    return [String(raw.subtype)];
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
    analysis: message.analysis ?? defaultAnalysisContext(),
    timestamp: message.timestamp,
    sessionId: message.sessionId
  };
}

function defaultAnalysisContext(): MessageAnalysisContext {
  return {
    kind: "unknown",
    turn: 0,
    segment: 0,
    stable_identifiers: [],
    evidence: []
  };
}
