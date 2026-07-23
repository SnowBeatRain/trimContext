import type { NormalizedMessage } from "../../types/message.js";
import type { SignalEvidence } from "../../types/signals.js";

const MAX_SIMILAR_LOOKBACK = 64;

export function detectDuplicateEvidence(messages: NormalizedMessage[]): Map<string, SignalEvidence[]> {
  const evidence = new Map<string, SignalEvidence[]>();
  const exactGroups = new Map<string, number[]>();
  const similarBuckets = new Map<string, number[]>();

  for (const [index, message] of messages.entries()) {
    const analysis = message.analysis;
    if (!analysis) continue;
    const normalized = normalizeDuplicateContent(message.content);
    if (normalized.length < 8) continue;
    const bucket = comparisonBucket(message);
    const exactKey = `${exactComparisonScope(message, messages, index)}|${normalized}`;
    const group = exactGroups.get(exactKey) ?? [];
    group.push(index);
    exactGroups.set(exactKey, group);

    const candidates = similarBuckets.get(bucket) ?? [];
    for (const previousIndex of candidates.slice(-MAX_SIMILAR_LOOKBACK)) {
      const previous = messages[previousIndex]!;
      const similarity = tokenJaccard(normalized, normalizeDuplicateContent(previous.content));
      const sharedIdentifier = analysis.stable_identifiers.some((id) => previous.analysis?.stable_identifiers.includes(id));
      if (similarity >= 0.86 && similarity < 1 && (message.role !== "user" || sharedIdentifier)) {
        addEvidence(evidence, previous, createEvidence(previous, "similar_duplicate", "medium", message, { similarity }));
      }
    }
    similarBuckets.set(bucket, [...candidates, index].slice(-MAX_SIMILAR_LOOKBACK));
  }

  for (const indices of exactGroups.values()) {
    if (indices.length < 2) continue;
    const canonicalIndex = chooseCanonical(indices, messages);
    const canonical = messages[canonicalIndex]!;
    for (const index of indices) {
      if (index !== canonicalIndex) {
        addEvidence(evidence, messages[index]!, createEvidence(messages[index]!, "exact_duplicate", "high", canonical, { normalized: true }));
      }
    }
  }
  return evidence;
}

function comparisonBucket(message: NormalizedMessage): string {
  const analysis = message.analysis!;
  const target = normalizedToolTarget(message);
  if (message.tool?.isToolUse || message.tool?.isToolResult) {
    return target ? `${analysis.segment}|${analysis.kind}|${message.role}|${target}` : `no-target:${message.id}`;
  }
  return `${analysis.segment}|${analysis.kind}|${message.role}|`;
}

function exactComparisonScope(message: NormalizedMessage, messages: NormalizedMessage[], index: number): string {
  const analysis = message.analysis!;
  if (message.tool?.isToolUse) {
    return toolScope(message, normalizedToolTarget(message));
  }
  if (message.tool?.isToolResult) {
    const target = targetForToolResult(message, messages, index);
    return target ? `${analysis.segment}|${analysis.kind}|${message.role}|${target}` : `no-result-target:${message.id}`;
  }
  return `${analysis.segment}|${analysis.kind}|${message.role}|`;
}

function toolScope(message: NormalizedMessage, target: string | undefined): string {
  const analysis = message.analysis!;
  return target ? `${analysis.segment}|${analysis.kind}|${message.role}|${target}` : `no-tool-target:${message.id}`;
}

function targetForToolResult(message: NormalizedMessage, messages: NormalizedMessage[], index: number): string | undefined {
  const id = message.tool?.toolResultFor;
  if (!id) return undefined;
  const use = messages.find((candidate, candidateIndex) =>
    candidateIndex < index && candidate.analysis?.segment === message.analysis?.segment && candidate.tool?.isToolUse && candidate.tool.toolUseId === id
  );
  return use ? normalizedToolTarget(use) : undefined;
}

function chooseCanonical(indices: number[], messages: NormalizedMessage[]): number {
  return [...indices].sort((left, right) => {
    const leftReferenced = isReferencedLater(messages[left]!, left, messages, indices) ? 1 : 0;
    const rightReferenced = isReferencedLater(messages[right]!, right, messages, indices) ? 1 : 0;
    if (leftReferenced !== rightReferenced) return rightReferenced - leftReferenced;
    const completeness = contentCompleteness(messages[right]!) - contentCompleteness(messages[left]!);
    if (completeness !== 0) return completeness;
    return right - left;
  })[0]!;
}

function contentCompleteness(message: NormalizedMessage): number {
  const text = message.content.trim();
  const structured = message.tool?.isToolUse ? normalizedToolTarget(message)?.length ?? 0 : 0;
  return Math.min(text.length, 4_000) + structured;
}

function isReferencedLater(message: NormalizedMessage, index: number, messages: NormalizedMessage[], exactGroup: number[]): boolean {
  const identifiers = message.analysis?.stable_identifiers ?? [];
  if (identifiers.length === 0) return false;
  for (let later = index + 1; later < messages.length; later += 1) {
    const entry = messages[later]!;
    if (entry.analysis?.segment !== message.analysis?.segment) break;
    if (!exactGroup.includes(later) && !entry.tool?.isToolResult && !entry.tool?.isToolUse && identifiers.some((id) => entry.content.toLowerCase().includes(id))) {
      return true;
    }
  }
  return false;
}

export function normalizeDuplicateContent(content: string): string {
  return content
    .replace(/^\s*\[(?:assistant|user)\][\s:]*/i, "")
    .replace(/^\s*\[tool_(?:use|result)(?:\s+[^\]]+)?\]\s*/i, "")
    .replace(/\b(?:uuid|id|message_id)\s*[:=]\s*[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizedToolTarget(message: NormalizedMessage): string | undefined {
  const toolName = message.tool?.toolName?.trim().toLowerCase();
  if (!toolName) return undefined;
  const structured = structuredToolTarget(message.raw) ?? structuredToolTarget(message.content);
  if (structured) return `${toolName}:${structured}`;
  const identifiers = message.analysis?.stable_identifiers ?? [];
  if (identifiers.length > 0) return `${toolName}:${[...identifiers].sort().join("|")}`;
  const fallback = normalizeDuplicateContent(message.content)
    .replace(new RegExp(`^${escapeRegExp(toolName)}\\s+[a-z0-9_-]+\\s*`, "i"), "")
    .trim();
  return fallback.length >= 12 ? `${toolName}:${fallback}` : undefined;
}

function structuredToolTarget(value: unknown): string | undefined {
  const candidates: string[] = [];
  const visit = (current: unknown, depth: number) => {
    if (depth > 4 || current === null || current === undefined) return;
    if (typeof current === "string") {
      const text = current.trim();
      const json = text.startsWith("{") || text.startsWith("[") ? text : text.match(/\{[\s\S]*\}\s*$/)?.[0];
      if (json && json.length > 1) {
        try { visit(JSON.parse(json), depth + 1); } catch { /* structured fallback below */ }
      }
      for (const match of text.matchAll(/"(file_path|path|query|command|cmd|url|pattern|target)"\s*:\s*"([^"]+)"/gi)) {
        candidates.push(`${match[1]!.toLowerCase()}=${match[2]!.trim().toLowerCase().replace(/\s+/g, " ")}`);
      }
      return;
    }
    if (typeof current !== "object") return;
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (/^(?:file_path|path|query|command|cmd|url|pattern|target)$/i.test(key) && typeof child === "string" && child.trim()) {
        candidates.push(`${key.toLowerCase()}=${child.trim().toLowerCase().replace(/\s+/g, " ")}`);
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return candidates.length > 0 ? [...new Set(candidates)].sort().join("&") : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tokenJaccard(left: string, right: string): number {
  const leftTerms = new Set(left.match(/[\p{L}\p{N}_./-]{3,}/gu) ?? []);
  const rightTerms = new Set(right.match(/[\p{L}\p{N}_./-]{3,}/gu) ?? []);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  const intersection = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return intersection / new Set([...leftTerms, ...rightTerms]).size;
}

export function createEvidence(
  message: NormalizedMessage,
  code: SignalEvidence["code"],
  confidence: SignalEvidence["confidence"],
  related: NormalizedMessage | undefined,
  details: SignalEvidence["details"]
): SignalEvidence {
  return {
    code,
    confidence,
    message_id: message.id,
    source_line: message.sourceLine,
    role: message.role,
    ...(related ? { related_message_id: related.id, related_source_line: related.sourceLine } : {}),
    ...("similarity" in details && typeof details.similarity === "number" ? { similarity: details.similarity } : {}),
    details: { ...details, ...(details.strength === undefined && decisiveStrength(code) !== undefined ? { strength: decisiveStrength(code)! } : {}) }
  };
}

function decisiveStrength(code: SignalEvidence["code"]): number | undefined {
  return ({ low_value_metadata: 0.9, exact_duplicate: 0.82, superseded: 0.78, obsolete_tool_output: 0.72, similar_duplicate: 0.65, orphan_tool_result: 0.65 } as Partial<Record<SignalEvidence["code"], number>>)[code];
}

export function addEvidence(target: Map<string, SignalEvidence[]>, message: NormalizedMessage, entry: SignalEvidence): void {
  const entries = target.get(message.id) ?? [];
  if (!entries.some((current) => current.code === entry.code && current.related_message_id === entry.related_message_id)) {
    entries.push(entry);
    target.set(message.id, entries);
  }
}
