import type { NormalizedMessage } from "../../types/message.js";
import type { MessageAnalysisContext, MessageKind } from "../../types/signals.js";

const MAX_STABLE_IDENTIFIERS = 24;
const METADATA_PREFIX = /^\[(?:isMeta|mode|permission-mode|attachment|last-prompt|file-history-snapshot|ai-title|compacted)\]\s*/i;
const METADATA_EVENT_TYPES = new Set(["mode", "permission-mode", "attachment", "last-prompt", "compacted"]);
const ACTION_PATTERN = /\b(?:add|analyze|build|change|check|create|fix|implement|inspect|remove|retry|review|run|update|write|proceed|continue)\b|(?:请|帮我|修复|实现|更新|新增|删除|检查|分析|继续|处理|执行|重试)/i;
const ACK_PATTERN = /^(?:ack|got it|ok|okay|yes|yep|sure|no|understood|looks good|sounds good|thank(?:s)?|thank you(?: very much)?|great|perfect|好的|可以|确认|收到|明白|知道了|谢谢|感谢|没问题)[.!。！]?$/i;

export function classifyMessage(message: NormalizedMessage): MessageKind {
  if (message.tool?.isToolUse) return "tool_use";
  if (message.role === "tool" || message.tool?.isToolResult) return "tool_result";
  if (isMetadata(message)) return "metadata";
  if (message.role === "system" || message.role === "developer") return "instruction";
  if (looksLikeTestOrError(message.content)) return "test_or_error";
  if (message.role === "user" && isSubstantiveUserGoal(message.content)) return "user_goal";
  if (looksLikeDecision(message.content)) return "decision";
  if (looksLikePlan(message.content)) return "plan";
  if (message.role === "assistant" && looksLikeProgress(message.content)) return "progress";
  if (message.role === "assistant" && looksLikeResult(message.content)) return "result";
  return "unknown";
}

export function stableIdentifiers(content: string): string[] {
  const identifiers: string[] = [];
  const add = (value: string) => {
    const normalized = value.toLowerCase();
    if (normalized && !identifiers.includes(normalized) && identifiers.length < MAX_STABLE_IDENTIFIERS) {
      identifiers.push(normalized);
    }
  };

  for (const match of content.matchAll(/\/(?:v\d+)(?:\/[a-z0-9._-]+)+\b/gi)) add(match[0]);
  for (const match of content.matchAll(/(?:[A-Za-z]:\\|~?\/)?(?:[\w.-]+[\\/])+[\w.-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|java|vue|css|html)\b/g)) add(match[0]);
  for (const match of content.matchAll(/--[a-z][a-z0-9-]*/gi)) add(match[0]);
  for (const match of content.matchAll(/\b(?:E\d{3,5}|ERR_[A-Z0-9_]+|HTTP_[1-5]\d{2})\b/g)) add(match[0]);
  for (const match of content.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) add(match[0]);
  for (const match of content.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/gi)) add(match[0]);
  for (const match of content.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/gi)) add(match[0]);

  return identifiers;
}

export function annotateMessageContext(messages: NormalizedMessage[]): NormalizedMessage[] {
  let currentTurn = 0;
  let currentSegment = 0;
  let sawUserGoal = false;
  let previousUserIdentifiers: string[] | undefined;

  return messages.map((message) => {
    const kind = classifyMessage(message);
    const identifiers = stableIdentifiers(message.content);
    const substantiveUser = isSubstantiveUserMessage(message);

    if (isCompactBoundaryMessage(message)) {
      currentSegment += 1;
    }

    if (substantiveUser) {
      if (sawUserGoal) {
        currentTurn += 1;
        if (isExplicitTaskSwitch(message.content) && !hasIdentifierOverlap(previousUserIdentifiers ?? [], identifiers)) {
          currentSegment += 1;
        }
      } else {
        sawUserGoal = true;
      }
      previousUserIdentifiers = identifiers;
    }

    const analysis: MessageAnalysisContext = {
      kind,
      turn: currentTurn,
      segment: currentSegment,
      stable_identifiers: identifiers,
      evidence: []
    };
    return { ...message, analysis };
  });
}

function isMetadata(message: NormalizedMessage): boolean {
  const raw = asRecord(message.raw);
  const rawType = typeof raw?.type === "string" ? raw.type : undefined;
  return METADATA_PREFIX.test(message.content) || (rawType !== undefined && METADATA_EVENT_TYPES.has(rawType));
}

export function isCompactBoundaryMessage(message: NormalizedMessage): boolean {
  const raw = asRecord(message.raw);
  return (
    message.source === "claude-code-jsonl" &&
    raw?.type === "system" &&
    (raw.subtype === "away_summary" || raw.subtype === "compact_boundary")
  ) || (
    message.source === "codex-jsonl" && raw?.type === "compacted"
  );
}

function isSubstantiveUserMessage(message: NormalizedMessage): boolean {
  if (message.role !== "user" || isMetadata(message)) return false;
  const content = message.content.trim();
  if (ACK_PATTERN.test(content)) return false;
  return ACTION_PATTERN.test(content) || content.length >= 8;
}

function isSubstantiveUserGoal(content: string): boolean {
  const compact = content.trim();
  if (METADATA_PREFIX.test(compact) || ACK_PATTERN.test(compact)) return false;
  return ACTION_PATTERN.test(compact) || (
    compact.length >= 8 &&
    /\?/.test(compact)
  );
}

function looksLikeTestOrError(content: string): boolean {
  return /\b(?:FAIL|FAILED|AssertionError|TypeError|ReferenceError|Error:)\b|\bexpected\b.+\b(?:received|to be)\b/i.test(content);
}

function looksLikeDecision(content: string): boolean {
  return /\b(?:decision|choice)\s*:|\b(?:we decided|choose|chosen|settled on)\b|(?:决定|采用|确定使用)/i.test(content);
}

function looksLikePlan(content: string): boolean {
  return /^\s*(?:plan:|\d+[.)]\s)|\b(?:plan|steps?)\s*:/im.test(content);
}

function looksLikeProgress(content: string): boolean {
  return /\b(?:I(?:'m| am| will)|checking|inspecting|working on|running)\b|(?:正在|我会|我将)/i.test(content);
}

function looksLikeResult(content: string): boolean {
  return /\b(?:done|completed|implemented|finished)\b|\bresult\s*:|(?:已完成|完成了|结果：)/i.test(content);
}

function isExplicitTaskSwitch(content: string): boolean {
  return /\b(?:new task|different task|unrelated|switch(?:ing)? to)\b|(?:新任务|切换任务|另外一个任务)/i.test(content);
}

function hasIdentifierOverlap(left: string[], right: string[]): boolean {
  const known = new Set(left);
  return right.some((identifier) => known.has(identifier));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
