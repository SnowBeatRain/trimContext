import type { AnalyzedMessage, FindingEvidenceRef } from "../types/report.js";

export function toEvidenceRef(
  item: AnalyzedMessage["analysis"]["evidence"][number]
): FindingEvidenceRef {
  return {
    message_id: item.message_id,
    source_line: item.source_line,
    role: item.role,
    code: item.code,
    confidence: item.confidence,
    ...(item.related_message_id ? { related_message_id: item.related_message_id } : {})
  };
}

export function highestConfidence(
  values: FindingEvidenceRef["confidence"][]
): FindingEvidenceRef["confidence"] {
  if (values.length === 0) return "medium";
  return values.slice(1).reduce<FindingEvidenceRef["confidence"]>(
    (highest, value) => confidenceRank(value) > confidenceRank(highest) ? value : highest,
    values[0]!
  );
}

export function confidenceRank(value: FindingEvidenceRef["confidence"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}
