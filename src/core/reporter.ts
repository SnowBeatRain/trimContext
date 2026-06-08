import type { AnalysisReport, AnalyzedMessage } from "../types/report.js";
import type { NormalizedMessage } from "../types/message.js";

export function createReport(messages: NormalizedMessage[], file: string): AnalysisReport {
  const analyzedMessages = messages.map(toAnalyzedMessage);
  const removeCandidates = analyzedMessages.filter((message) => message.decision === "remove_candidate");
  const totalTokens = analyzedMessages.reduce((sum, message) => sum + message.tokens, 0);
  const savingTokens = removeCandidates.reduce((sum, message) => sum + message.tokens, 0);

  return {
    schema_version: "trimctx.report.v1",
    input: {
      file,
      source: messages[0]?.source ?? "openai-jsonl"
    },
    summary: {
      total_messages: analyzedMessages.length,
      total_tokens: totalTokens,
      remove_candidates: removeCandidates.length,
      estimated_saving_ratio: totalTokens === 0 ? 0 : Number((savingTokens / totalTokens).toFixed(4)),
      estimated_saving_tokens: savingTokens,
      protected_messages: analyzedMessages.filter((message) => message.protected).length,
      compress_candidates: analyzedMessages.filter((message) => message.decision === "compress_candidate").length,
      top_reasons: countTopReasons(analyzedMessages)
    },
    messages: analyzedMessages,
    remove_candidates: removeCandidates,
    warnings: []
  };
}

function countTopReasons(messages: AnalyzedMessage[]): AnalysisReport["summary"]["top_reasons"] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const reason of message.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([leftReason, leftCount], [rightReason, rightCount]) => {
      if (rightCount !== leftCount) return rightCount - leftCount;
      return leftReason.localeCompare(rightReason);
    })
    .slice(0, 5)
    .map(([reason, count]) => ({
      reason: reason as AnalysisReport["summary"]["top_reasons"][number]["reason"],
      count
    }));
}

function toAnalyzedMessage(message: NormalizedMessage): AnalyzedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    source: message.source,
    sourceLine: message.sourceLine,
    tokens: message.tokens ?? 0,
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
