import { ASSESSMENT_THRESHOLDS } from "./assessment.js";
import { confidenceRank, highestConfidence, toEvidenceRef } from "./report-evidence.js";
import type {
  AnalyzedMessage,
  CandidateGroup,
  Finding,
  FindingEvidenceRef
} from "../types/report.js";

const GROUP_TYPES: Partial<Record<FindingEvidenceRef["code"], CandidateGroup["type"]>> = {
  superseded: "superseded",
  exact_duplicate: "duplicate",
  similar_duplicate: "duplicate",
  orphan_tool_result: "tool",
  obsolete_tool_output: "tool",
  low_value_metadata: "metadata"
};

export function createCandidateGroups(messages: AnalyzedMessage[]): CandidateGroup[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const groups = new Map<string, {
    code: CandidateGroup["code"];
    type: CandidateGroup["type"];
    related?: string;
    entries: FindingEvidenceRef[];
  }>();
  for (const message of [...messages].sort((left, right) => left.sourceLine - right.sourceLine)) {
    for (const item of message.analysis.evidence) {
      const type = GROUP_TYPES[item.code];
      if (!type) continue;
      const key = `${item.code}:${item.related_message_id ?? "none"}`;
      const group = groups.get(key) ?? {
        code: item.code,
        type,
        related: item.related_message_id,
        entries: []
      };
      group.entries.push(toEvidenceRef(item));
      groups.set(key, group);
    }
  }
  return [...groups.entries()].map(([id, group]) => {
    const entries = [...group.entries].sort((left, right) => left.source_line - right.source_line
      || left.message_id.localeCompare(right.message_id));
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
  }).sort((left, right) => firstGroupLine(left) - firstGroupLine(right)
    || left.id.localeCompare(right.id));
}

export function createFindings(
  groups: CandidateGroup[],
  limitations: string[],
  messages: AnalyzedMessage[]
): Finding[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const groupsByCode = new Map<CandidateGroup["code"], CandidateGroup[]>();
  for (const group of groups) {
    const codeGroups = groupsByCode.get(group.code) ?? [];
    codeGroups.push(group);
    groupsByCode.set(group.code, codeGroups);
  }
  const totalTokens = messages.reduce((sum, message) => sum + message.tokens, 0);
  const signalFindings: Finding[] = [...groupsByCode.entries()].map(([code, codeGroups]) => {
    const memberIds = [...new Set(codeGroups.flatMap((group) => group.member_message_ids))]
      .sort((left, right) => (byId.get(left)?.sourceLine ?? Number.MAX_SAFE_INTEGER)
        - (byId.get(right)?.sourceLine ?? Number.MAX_SAFE_INTEGER)
        || left.localeCompare(right));
    const members = memberIds.flatMap((messageId) => {
      const message = byId.get(messageId);
      return message ? [message] : [];
    });
    const evidenceByRelationship = new Map<string, FindingEvidenceRef>();
    for (const entry of codeGroups.flatMap((group) => group.evidence)) {
      const key = `${entry.message_id}\u0000${entry.code}\u0000${entry.related_message_id ?? ""}`;
      const existing = evidenceByRelationship.get(key);
      if (!existing || confidenceRank(entry.confidence) > confidenceRank(existing.confidence)) {
        evidenceByRelationship.set(key, entry);
      }
    }
    const evidence = [...evidenceByRelationship.values()].sort(compareEvidence);
    const tokens = members.reduce((sum, message) => sum + message.tokens, 0);
    const type = codeGroups[0]!.type;
    const confidence = highestConfidence(evidence.map((entry) => entry.confidence));
    return {
      id: `signal:${code}`,
      type,
      severity: findingSeverity(members),
      confidence,
      code,
      title: `${titleCase(type)} context evidence`,
      explanation: `${code} evidence groups related messages for human review.`,
      summary: `${memberIds.length} message(s) grouped by ${code}.`,
      impact: {
        message_count: memberIds.length,
        tokens,
        token_ratio: ratio(tokens, totalTokens)
      },
      suggested_action: suggestedAction(type),
      tokens,
      evidence
    };
  }).sort(compareFindings);
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
  return [...signalFindings, ...limitationFindings];
}

function firstGroupLine(group: CandidateGroup): number {
  return group.evidence[0]?.source_line ?? Number.MAX_SAFE_INTEGER;
}

function compareEvidence(left: FindingEvidenceRef, right: FindingEvidenceRef): number {
  return left.source_line - right.source_line
    || left.message_id.localeCompare(right.message_id)
    || (left.related_message_id ?? "").localeCompare(right.related_message_id ?? "")
    || left.code.localeCompare(right.code);
}

function compareFindings(left: Finding, right: Finding): number {
  return severityRank(right.severity) - severityRank(left.severity)
    || confidenceRank(right.confidence) - confidenceRank(left.confidence)
    || right.tokens - left.tokens
    || (left.evidence[0]?.source_line ?? Number.MAX_SAFE_INTEGER)
      - (right.evidence[0]?.source_line ?? Number.MAX_SAFE_INTEGER)
    || left.code.localeCompare(right.code);
}

function findingSeverity(messages: AnalyzedMessage[]): Finding["severity"] {
  if (messages.some((message) => message.decision === "remove_candidate")) return "critical";
  if (messages.some((message) => message.decision === "compress_candidate"
    || (message.protected && message.rot_score >= ASSESSMENT_THRESHOLDS.protected_high_rot))) return "warning";
  return "info";
}

function severityRank(value: Finding["severity"]): number {
  return value === "critical" ? 3 : value === "warning" ? 2 : 1;
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
