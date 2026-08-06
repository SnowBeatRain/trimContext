import { confidenceRank, highestConfidence, toEvidenceRef } from "./report-evidence.js";
import type {
  AnalysisReport,
  AnalyzedMessage,
  Recommendation,
  ReviewQueueItem
} from "../types/report.js";
import type { SignalCode } from "../types/signals.js";

const DECISIVE_CODES = new Set<SignalCode>([
  "low_value_metadata",
  "exact_duplicate",
  "superseded",
  "obsolete_tool_output",
  "similar_duplicate",
  "orphan_tool_result"
]);

export function createReviewQueue(messages: AnalyzedMessage[]): ReviewQueueItem[] {
  return messages
    .filter((message) => message.decision === "remove_candidate"
      || message.decision === "compress_candidate"
      || (message.protected && message.rot_score >= 0.6))
    .map((message) => {
      const evidence = message.analysis.evidence.map(toEvidenceRef);
      if ((message.decision === "remove_candidate" || message.decision === "compress_candidate")
          && message.reasons.length === 0) {
        throw new Error(`${message.decision} ${message.id} must have at least one reason`);
      }
      if (message.decision === "remove_candidate") {
        if (message.protected) {
          throw new Error(`remove_candidate ${message.id} must not be protected`);
        }
        if (!evidence.some((entry) => entry.confidence === "high"
          && DECISIVE_CODES.has(entry.code as SignalCode))) {
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
        risk: message.decision === "remove_candidate"
          ? "high"
          : message.decision === "compress_candidate" ? "medium" : "low",
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

export function createRecommendations(
  file: string,
  health: AnalysisReport["assessment"]["status"],
  readiness: AnalysisReport["resume"]["readiness"],
  removeCount: number
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  if (health === "unknown") recommendations.push({
    code: "write_report",
    priority: 1,
    summary: "Write the full JSON report before drawing a health conclusion.",
    command: `trimctx report ${quotePath(file)} -o report.json`
  });
  if (readiness.level !== "ready") recommendations.push({
    code: "clarify_continuation",
    priority: 2,
    summary: readiness.missing.length > 0
      ? `Add missing continuation evidence before continuing: ${readiness.missing.join(", ")}.`
      : "Add missing continuation evidence before continuing."
  });
  if (health === "degraded" && readiness.level !== "blocked") recommendations.push({
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

function riskRank(value: ReviewQueueItem["risk"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
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
