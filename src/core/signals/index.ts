import type { NormalizedMessage } from "../../types/message.js";
import type { SignalEvidence } from "../../types/signals.js";
import { detectDuplicateEvidence } from "./duplicates.js";
import { detectMetadataEvidence } from "./metadata.js";
import { detectSupersessionEvidence } from "./supersession.js";
import { detectToolEvidence } from "./tools.js";
import { normalizeDuplicateContent } from "./duplicates.js";

export function attachSignalEvidence(messages: NormalizedMessage[]): NormalizedMessage[] {
  const detectors = [detectDuplicateEvidence(messages), detectSupersessionEvidence(messages), detectToolEvidence(messages), detectMetadataEvidence(messages)];
  const finalTurn = Math.max(0, ...messages.map((message) => message.analysis?.turn ?? 0));
  return messages.map((message, index) => {
    const evidence = detectors.flatMap((detector) => detector.get(message.id) ?? []);
    if (message.analysis && message.analysis.turn < finalTurn) {
      evidence.push(support(message, "old_message", undefined, { turns_behind: finalTurn - message.analysis.turn }));
    }
    if (message.analysis && !hasLaterReference(message, index, messages)) {
      evidence.push(support(message, "low_reference", undefined, { checked_segment: message.analysis.segment }));
    }
    const unique = evidence.filter((entry, entryIndex, list) => list.findIndex((other) => other.code === entry.code && other.related_message_id === entry.related_message_id) === entryIndex)
      .sort((left, right) => left.source_line - right.source_line || left.code.localeCompare(right.code));
    return { ...message, analysis: message.analysis ? { ...message.analysis, evidence: unique } : message.analysis };
  });
}

function hasLaterReference(message: NormalizedMessage, index: number, messages: NormalizedMessage[]): boolean {
  const identifiers = message.analysis!.stable_identifiers;
  const phrase = normalizeDuplicateContent(message.content);
  return messages.slice(index + 1).some((candidate) => {
    if (candidate.analysis?.segment !== message.analysis!.segment) return false;
    if (identifiers.some((id) => candidate.analysis?.stable_identifiers.includes(id))) return true;
    return phrase.length >= 16 && normalizeDuplicateContent(candidate.content).includes(phrase);
  });
}

function support(message: NormalizedMessage, code: "old_message" | "low_reference", related: NormalizedMessage | undefined, details: SignalEvidence["details"]): SignalEvidence {
  return { code, confidence: "low", message_id: message.id, source_line: message.sourceLine, role: message.role, ...(related ? { related_message_id: related.id, related_source_line: related.sourceLine } : {}), details };
}
