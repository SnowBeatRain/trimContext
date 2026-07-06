import type { Decision, NormalizedMessage, Reason } from "../types/message.js";
import type { ResolvedAnalysisOptions } from "./options.js";
import { computeRotScores } from "./rot-metrics.js";

export function scoreMessages(messages: NormalizedMessage[], options: Pick<ResolvedAnalysisOptions, "removeThreshold" | "compressThreshold"> = { removeThreshold: 0.8, compressThreshold: 0.6 }): NormalizedMessage[] {
  const toolUses = new Set(messages.map((message) => message.tool?.toolUseId).filter(Boolean));

  return messages.map((message, index) => {
    const scores = computeRotScores(message, index, messages, toolUses);
    const reasons = new Set<Reason>(message.reasons ?? []);

    // Reasons explain score decisions and keep report/remove behavior auditable.
    if (scores.superseded_score > 0) reasons.add("superseded_by_later_instruction");
    if (scores.low_reference_score >= 0.75) reasons.add("low_reference_in_later_context");
    if (scores.age_score >= 0.7) reasons.add("old_message");
    if (scores.redundancy_score >= 0.85) reasons.add("duplicate_nearby_message");
    if (scores.orphan_tool_score > 0) reasons.add("orphan_tool_result");
    if (scores.orphan_tool_score > 0 && (message.tokens ?? 0) > 200) reasons.add("large_low_value_tool_output");
    if (scores.low_value_score >= 0.6) reasons.add("low_value_metadata");

    let decision: Decision = message.protected ? "keep_protected" : "keep";
    if (!message.protected && scores.rot_score >= options.removeThreshold) {
      decision = "remove_candidate";
    } else if (!message.protected && scores.rot_score >= options.compressThreshold) {
      decision = "compress_candidate";
    }

    if (decision === "remove_candidate" && reasons.size === 0) {
      reasons.add("old_message");
    }

    return {
      ...message,
      scores,
      rot_score: scores.rot_score,
      decision,
      reasons: [...reasons]
    };
  });
}
