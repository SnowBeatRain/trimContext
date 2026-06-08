import type { Decision, NormalizedMessage, Reason, RotScores } from "../types/message.js";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "is",
  "are",
  "use",
  "this",
  "that",
  "it",
  "we",
  "i",
  "you"
]);

export function scoreMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const toolUses = new Set(messages.map((message) => message.tool?.toolUseId).filter(Boolean));

  return messages.map((message, index) => {
    const scores = computeScores(message, index, messages, toolUses);
    const reasons = new Set<Reason>(message.reasons ?? []);

    if (scores.superseded_score > 0) reasons.add("superseded_by_later_instruction");
    if (scores.low_reference_score >= 0.75) reasons.add("low_reference_in_later_context");
    if (scores.age_score >= 0.7) reasons.add("old_message");
    if (scores.redundancy_score >= 0.85) reasons.add("duplicate_nearby_message");
    if (scores.orphan_tool_score > 0) reasons.add("orphan_tool_result");
    if (scores.orphan_tool_score > 0 && (message.tokens ?? 0) > 200) reasons.add("large_low_value_tool_output");
    if (scores.low_value_score >= 0.6) reasons.add("low_value_metadata");

    let decision: Decision = message.protected ? "keep_protected" : "keep";
    if (!message.protected && scores.rot_score >= 0.8) {
      decision = "remove_candidate";
    } else if (!message.protected && scores.rot_score >= 0.6) {
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

function computeScores(
  message: NormalizedMessage,
  index: number,
  messages: NormalizedMessage[],
  toolUses: Set<string | undefined>
): RotScores {
  const superseded_score = supersededScore(message, index, messages);
  const low_reference_score = lowReferenceScore(message, index, messages);
  const age_score = messages.length <= 1 ? 0 : clamp(1 - index / (messages.length - 1));
  const redundancy_score = redundancyScore(message, index, messages);
  const orphan_tool_score = orphanToolScore(message, toolUses);
  const low_value_score = lowValueScore(message);
  const base_rot_score = clamp(
    0.3 * superseded_score +
      0.25 * low_reference_score +
      0.2 * age_score +
      0.15 * redundancy_score +
      0.1 * orphan_tool_score
  );
  const importance_discount = computeImportanceDiscount(message);
  const rot_score = clamp(Math.max(base_rot_score, low_value_score) - importance_discount);

  return {
    superseded_score,
    low_reference_score,
    age_score,
    redundancy_score,
    orphan_tool_score,
    low_value_score,
    rot_score
  };
}

function supersededScore(message: NormalizedMessage, index: number, messages: NormalizedMessage[]): number {
  const terms = keywords(message.content);
  const later = messages.slice(index + 1, Math.min(messages.length, index + 12));
  const overridePattern = /(correction|instead|ignore previous|replace|do not use|don't use|改成|更新|不要用|忽略之前)/i;
  const matched = later.some((candidate) => {
    if (!overridePattern.test(candidate.content)) return false;
    const candidateTerms = keywords(candidate.content);
    return jaccard(terms, candidateTerms) > 0.05 || terms.some((term) => candidateTerms.includes(term));
  });
  return matched ? 1 : 0;
}

function lowReferenceScore(message: NormalizedMessage, index: number, messages: NormalizedMessage[]): number {
  const terms = keywords(message.content);
  if (terms.length === 0) return 0.5;
  const laterText = messages
    .slice(index + 1)
    .filter((candidate) => jaccard(terms, keywords(candidate.content)) < 0.85)
    .map((candidate) => candidate.content.toLowerCase())
    .join("\n");
  const hits = terms.filter((term) => laterText.includes(term.toLowerCase())).length;
  return clamp(1 - hits / Math.min(terms.length, 8));
}

function redundancyScore(message: NormalizedMessage, index: number, messages: NormalizedMessage[]): number {
  const terms = keywords(message.content);
  if (terms.length === 0) return 0;
  const nearby = messages.slice(Math.max(0, index - 3), Math.min(messages.length, index + 4));
  return nearby
    .filter((_, nearbyIndex) => Math.max(0, index - 3) + nearbyIndex !== index)
    .reduce((max, candidate) => Math.max(max, jaccard(terms, keywords(candidate.content))), 0);
}

function orphanToolScore(message: NormalizedMessage, toolUses: Set<string | undefined>): number {
  if (message.tool?.isToolResult && message.tool.toolResultFor && !toolUses.has(message.tool.toolResultFor)) {
    return 1;
  }
  if (message.tool?.isToolUse && message.tool.toolUseId) {
    return 0;
  }
  return 0;
}

function lowValueScore(message: NormalizedMessage): number {
  const content = message.content.toLowerCase();
  if (/^\[(file-history-snapshot|ai-title|mode|permission-mode)\]/.test(content)) {
    return 0.9;
  }
  if (/^\[last-prompt\]/.test(content)) {
    return 0.65;
  }
  if (/^\[attachment\]/.test(content) && /(mcp_instructions_delta|skill_listing)/.test(content)) {
    return 0.65;
  }
  return 0;
}

function keywords(content: string): string[] {
  const matches = content.toLowerCase().match(/[\p{L}\p{N}_./-]{3,}/gu) ?? [];
  return [...new Set(matches.filter((word) => !STOP_WORDS.has(word)))].slice(0, 20);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((item) => setB.has(item)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

const IMPORTANCE_DISCOUNTS: Record<string, number> = {
  contains_code_block: 0.15,
  contains_error_stack: 0.15,
  contains_git_diff: 0.15,
  contains_test_failure: 0.15,
  contains_shell_command: 0.1,
  contains_architecture_or_api_decision: 0.1,
  tool_result_referenced_later: 0.1,
  contains_file_path: 0.05,
  references_tool_result: 0.05
};

function computeImportanceDiscount(message: NormalizedMessage): number {
  let discount = 0;
  for (const reason of message.reasons ?? []) {
    discount += IMPORTANCE_DISCOUNTS[reason] ?? 0;
  }
  return discount;
}
