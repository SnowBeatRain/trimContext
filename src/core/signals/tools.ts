import type { NormalizedMessage } from "../../types/message.js";
import type { SignalEvidence } from "../../types/signals.js";
import { addEvidence, createEvidence, normalizedToolTarget } from "./duplicates.js";

export function detectToolEvidence(messages: NormalizedMessage[]): Map<string, SignalEvidence[]> {
  const evidence = new Map<string, SignalEvidence[]>();
  const uses = new Map<string, number>();
  const results = new Map<string, number>();
  for (const [index, message] of messages.entries()) {
    if (message.tool?.isToolUse && message.tool.toolUseId) uses.set(message.tool.toolUseId, index);
    if (message.tool?.isToolResult && message.tool.toolResultFor) results.set(message.tool.toolResultFor, index);
  }
  for (const [id, resultIndex] of results) {
    if (!uses.has(id)) {
      const result = messages[resultIndex]!;
      addEvidence(evidence, result, createEvidence(result, "orphan_tool_result", "medium", undefined, { tool_use_id: id }));
    }
  }
  for (const [id, useIndex] of uses) {
    const use = messages[useIndex]!;
    const resultIndex = pairedResultIndex(id, useIndex, results, messages);
    if (resultIndex === undefined) continue;
    const result = messages[resultIndex]!;
    const replacementIndex = findReplacement(useIndex, use, results, messages);
    if (replacementIndex === undefined || isNarrativelyReferenced(result, resultIndex, messages)) continue;
    const replacement = messages[replacementIndex]!;
    addEvidence(evidence, result, createEvidence(result, "obsolete_tool_output", "medium", replacement, { tool_name: use.tool?.toolName ?? "" }));
  }
  return evidence;
}

function pairedResultIndex(id: string, useIndex: number, results: Map<string, number>, messages: NormalizedMessage[]): number | undefined {
  const resultIndex = results.get(id);
  const use = messages[useIndex]!;
  if (resultIndex === undefined || resultIndex <= useIndex) return undefined;
  return messages[resultIndex]?.analysis?.segment === use.analysis?.segment ? resultIndex : undefined;
}

function findReplacement(useIndex: number, use: NormalizedMessage, results: Map<string, number>, messages: NormalizedMessage[]): number | undefined {
  const target = normalizedToolTarget(use);
  if (!target) return undefined;
  for (let index = useIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index]!;
    if (candidate.analysis?.segment !== use.analysis?.segment) break;
    if (!candidate.tool?.isToolUse || normalizedToolTarget(candidate) !== target || candidate.tool.toolName?.toLowerCase() !== use.tool?.toolName?.toLowerCase()) continue;
    const resultIndex = candidate.tool.toolUseId ? results.get(candidate.tool.toolUseId) : undefined;
    const result = resultIndex === undefined ? undefined : messages[resultIndex];
    if (result && resultIndex! > index && result.analysis?.segment === candidate.analysis?.segment && !looksLikeFailure(result.content)) return index;
  }
  return undefined;
}

function looksLikeFailure(content: string): boolean {
  return /\b(?:error|failed|failure|exception|not found|denied)\b/i.test(content);
}

function isNarrativelyReferenced(message: NormalizedMessage, index: number, messages: NormalizedMessage[]): boolean {
  const id = message.tool?.toolUseId ?? message.tool?.toolResultFor;
  const identifiers = message.analysis?.stable_identifiers ?? [];
  const terms = distinctiveTerms(message.content);
  const consequential = /\b(?:error|failed|failure|exception|denied|permission|test|assertion)\b/i.test(message.content);
  for (let later = index + 1; later < messages.length; later += 1) {
    const entry = messages[later]!;
    if (entry.analysis?.segment !== message.analysis?.segment) break;
    if (entry.tool?.isToolUse || entry.tool?.isToolResult) continue;
    if (id && entry.content.includes(id)) return true;
    if (identifiers.some((identifier) => entry.analysis?.stable_identifiers.includes(identifier))) return true;
    const sharedTerms = [...distinctiveTerms(entry.content)].filter((term) => terms.has(term)).length;
    if (sharedTerms >= (consequential ? 2 : 3)) return true;
  }
  return false;
}

function distinctiveTerms(content: string): Set<string> {
  return new Set((content.toLowerCase().match(/[\p{L}\p{N}_]{4,}/gu) ?? [])
    .filter((term) => !new Set(["tool", "result", "output", "error", "with", "from", "that", "this", "fresh", "read"]).has(term)));
}
