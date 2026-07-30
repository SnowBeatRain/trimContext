import type { Decision, NormalizedMessage, Reason } from "../types/message.js";
import type { SignalCode } from "../types/signals.js";
import type { ResolvedAnalysisOptions } from "./options.js";
import { computeRotScores, hasDecisiveEvidence, isHighDecisive } from "./rot-metrics.js";

const REASONS: Partial<Record<SignalCode, Reason>> = {
  exact_duplicate: "duplicate_message",
  similar_duplicate: "duplicate_message",
  superseded: "superseded_by_later_instruction",
  orphan_tool_result: "orphan_tool_result",
  obsolete_tool_output: "obsolete_tool_output",
  low_value_metadata: "low_value_metadata",
  old_message: "old_message",
  low_reference: "low_reference_in_later_context"
};

export function scoreMessages(messages: NormalizedMessage[], options: Pick<ResolvedAnalysisOptions, "removeThreshold" | "compressThreshold"> = { removeThreshold: 0.8, compressThreshold: 0.6 }): NormalizedMessage[] {
  return messages.map((message) => {
    const scores = computeRotScores(message);
    const reasons = new Set<Reason>(message.reasons ?? []);
    for (const entry of message.analysis?.evidence ?? []) {
      const reason = REASONS[entry.code];
      if (reason) reasons.add(reason);
    }
    const protectedMessage = Boolean(message.protected);
    let decision: Decision = protectedMessage ? "keep_protected" : "keep";
    if (!protectedMessage && isHighDecisive(message) && scores.rot_score >= options.removeThreshold) {
      decision = "remove_candidate";
    } else if (!protectedMessage && hasDecisiveEvidence(message) && scores.rot_score >= options.compressThreshold) {
      decision = "compress_candidate";
    }
    return { ...message, scores, rot_score: scores.rot_score, decision, reasons: [...reasons] };
  });
}
