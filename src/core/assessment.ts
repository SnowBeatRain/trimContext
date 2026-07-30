import type { AnalyzedMessage, Assessment, HealthDimension } from "../types/report.js";
import type { ResumeState } from "../types/resume.js";
import type { SignalCode } from "../types/signals.js";

export const ASSESSMENT_THRESHOLDS = {
  minimum_messages: 5,
  protected_ratio_unknown: 0.9,
  unknown_role_ratio_unknown: 0.5,
  analyzable_ratio_unknown: 0.5,
  context_tokens_medium: 50_000,
  context_tokens_high: 150_000,
  stale_token_ratio_medium: 0.1,
  stale_token_ratio_high: 0.2,
  high_confidence_risks_degraded: 2,
  protected_high_rot: 0.6
} as const;

const STALE_CODES = new Set<SignalCode>([
  "superseded",
  "exact_duplicate",
  "similar_duplicate",
  "orphan_tool_result",
  "obsolete_tool_output",
  "low_value_metadata"
]);
const REPETITION_CODES = new Set<SignalCode>(["exact_duplicate", "similar_duplicate"]);
const TOOL_CODES = new Set<SignalCode>(["orphan_tool_result", "obsolete_tool_output"]);

export function createAssessment(
  messages: AnalyzedMessage[],
  resume: ResumeState,
  warnings: string[] = []
): Assessment {
  const totalMessages = messages.length;
  const totalTokens = sumTokens(messages);
  const analyzableMessages = messages.filter(isAnalyzable);
  const protectedMessages = messages.filter((message) => message.protected);
  const unknownRoleMessages = messages.filter((message) => message.role === "unknown");
  const protectedHighRot = messages.filter(
    (message) => message.protected && message.rot_score >= ASSESSMENT_THRESHOLDS.protected_high_rot
  );
  const staleMessages = uniqueMessages([
    ...messages.filter((message) => hasEvidence(message, STALE_CODES)),
    ...protectedHighRot
  ]);
  const repetitionMessages = messages.filter((message) => hasEvidence(message, REPETITION_CODES));
  const toolNoiseMessages = messages.filter((message) => hasEvidence(message, TOOL_CODES));
  const coverage = {
    analyzable_messages: analyzableMessages.length,
    analyzable_ratio: ratio(analyzableMessages.length, totalMessages),
    protected_ratio: ratio(protectedMessages.length, totalMessages),
    unknown_role_ratio: ratio(unknownRoleMessages.length, totalMessages)
  };
  const staleTokenRatio = ratio(sumTokens(staleMessages), totalTokens);
  const repetitionTokenRatio = ratio(sumTokens(repetitionMessages), totalTokens);
  const toolNoiseTokenRatio = ratio(sumTokens(toolNoiseMessages), totalTokens);
  const highConfidenceRiskSignalCount = messages.flatMap((message) => message.analysis.evidence)
    .filter((item) => item.confidence === "high" && STALE_CODES.has(item.code)).length;

  const limitations: string[] = [];
  if (totalMessages < ASSESSMENT_THRESHOLDS.minimum_messages) limitations.push("sample_too_short");
  if (coverage.protected_ratio >= ASSESSMENT_THRESHOLDS.protected_ratio_unknown) limitations.push("protected_coverage_too_high");
  if (coverage.unknown_role_ratio >= ASSESSMENT_THRESHOLDS.unknown_role_ratio_unknown) limitations.push("unknown_role_coverage_too_high");
  if (coverage.analyzable_ratio < ASSESSMENT_THRESHOLDS.analyzable_ratio_unknown) limitations.push("analyzable_coverage_too_low");

  const dimensions: Assessment["dimensions"] = {
    context_pressure: dimension(
      totalTokens >= ASSESSMENT_THRESHOLDS.context_tokens_high ? "high"
        : totalTokens >= ASSESSMENT_THRESHOLDS.context_tokens_medium ? "medium" : "low",
      ratio(totalTokens, ASSESSMENT_THRESHOLDS.context_tokens_high),
      totalMessages,
      `${totalTokens} estimated tokens`
    ),
    stale_context: dimension(levelForRatio(staleTokenRatio), staleTokenRatio, staleMessages.length, `${sumTokens(staleMessages)} stale-evidence tokens`),
    repetition: dimension(levelForRatio(repetitionTokenRatio), repetitionTokenRatio, repetitionMessages.length, `${sumTokens(repetitionMessages)} repeated-context tokens`),
    tool_noise: dimension(levelForRatio(toolNoiseTokenRatio), toolNoiseTokenRatio, toolNoiseMessages.length, `${sumTokens(toolNoiseMessages)} tool-noise tokens`),
    continuation: continuationDimension(resume),
    observability: observabilityDimension(coverage, warnings)
  };

  const unknown = limitations.length > 0;
  const degraded = dimensions.context_pressure.level === "high"
    || highConfidenceRiskSignalCount >= ASSESSMENT_THRESHOLDS.high_confidence_risks_degraded
    || staleTokenRatio >= ASSESSMENT_THRESHOLDS.stale_token_ratio_high;
  const attention = Object.values(dimensions).some((item) => item.level === "medium") || protectedHighRot.length > 0;
  const positiveEvidence = totalMessages >= ASSESSMENT_THRESHOLDS.minimum_messages
    && resume.readiness.level === "ready"
    && Object.values(dimensions).every((item) => item.level === "low");

  if (unknown) return result("unknown", "low", "Insufficient observable evidence for a reliable health label.", dimensions, coverage, limitations);
  if (degraded) return result("degraded", "high", "Multiple high-confidence or token-weighted risk signals require action.", dimensions, coverage, limitations);
  if (attention) return result("attention", "medium", "Reviewable context risks are present, but evidence does not meet degraded thresholds.", dimensions, coverage, limitations);
  if (positiveEvidence) return result("healthy", "high", "Sufficient observable evidence indicates low context risk.", dimensions, coverage, limitations);
  return result("unknown", "low", "Positive evidence is insufficient for a healthy label.", dimensions, coverage, ["insufficient_positive_evidence"]);
}

function result(
  status: Assessment["status"],
  confidence: Assessment["confidence"],
  summary: string,
  dimensions: Assessment["dimensions"],
  coverage: Assessment["coverage"],
  limitations: string[]
): Assessment {
  return { status, confidence, summary, dimensions, coverage, limitations };
}

function continuationDimension(resume: ResumeState): HealthDimension {
  if (resume.readiness.level === "ready") return dimension("low", 0, 5 - resume.readiness.missing.length, "Continuation evidence is ready.");
  if (resume.readiness.level === "partial") return dimension("medium", 0.5, 5 - resume.readiness.missing.length, "Continuation evidence is partial.");
  return dimension("high", 1, 5 - resume.readiness.missing.length, "Continuation evidence is blocked.");
}

function observabilityDimension(
  coverage: Assessment["coverage"],
  warnings: string[]
): HealthDimension {
  const score = Math.max(coverage.unknown_role_ratio, 1 - coverage.analyzable_ratio, warnings.length > 0 ? 0.5 : 0);
  const level = coverage.unknown_role_ratio >= ASSESSMENT_THRESHOLDS.unknown_role_ratio_unknown
      || coverage.analyzable_ratio < ASSESSMENT_THRESHOLDS.analyzable_ratio_unknown
    ? "high"
    : warnings.length > 0 || coverage.unknown_role_ratio > 0.1 || coverage.analyzable_ratio < 0.8 ? "medium" : "low";
  return dimension(level, score, warnings.length, `${warnings.length} warning(s); role and content coverage measured.`);
}

function dimension(level: HealthDimension["level"], score: number, evidenceCount: number, summary: string): HealthDimension {
  return { level, score: clamp(score), evidence_count: evidenceCount, summary };
}

function levelForRatio(value: number): HealthDimension["level"] {
  if (value >= ASSESSMENT_THRESHOLDS.stale_token_ratio_high) return "high";
  if (value >= ASSESSMENT_THRESHOLDS.stale_token_ratio_medium) return "medium";
  return "low";
}

function hasEvidence(message: AnalyzedMessage, codes: Set<SignalCode>): boolean {
  return message.analysis.evidence.some((item) => codes.has(item.code));
}

function isAnalyzable(message: AnalyzedMessage): boolean {
  return (message.role === "user" || message.role === "assistant" || message.role === "tool")
    && message.content.trim().length > 0;
}

function uniqueMessages(messages: AnalyzedMessage[]): AnalyzedMessage[] {
  return [...new Map(messages.map((message) => [message.id, message])).values()];
}

function sumTokens(messages: AnalyzedMessage[]): number {
  return messages.reduce((sum, message) => sum + message.tokens, 0);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function clamp(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}
