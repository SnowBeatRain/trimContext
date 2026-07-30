import type { NormalizedMessage, MessageToolInfo } from "../types/message.js";

interface CodexToolItemContext {
  payload: Record<string, unknown>;
  outerRaw: Record<string, unknown>;
  rawLine: string;
  sourceLine: number;
  id: string;
}

export function normalizeCodexToolUse(context: CodexToolItemContext, defaultToolName: string, argumentField: "arguments" | "input"): NormalizedMessage {
  const toolName = typeof context.payload.name === "string" ? context.payload.name : defaultToolName;
  const callId = typeof context.payload.call_id === "string" ? context.payload.call_id : undefined;
  const input = typeof context.payload[argumentField] === "string"
    ? context.payload[argumentField]
    : safeJson(context.payload[argumentField]);
  const tool: MessageToolInfo = {
    toolName,
    toolUseId: callId,
    isToolUse: true
  };

  return {
    id: context.id,
    role: "assistant",
    content: `[tool_use ${toolName}${callId ? ` ${callId}` : ""}] ${input}`,
    source: "codex-jsonl",
    sourceLine: context.sourceLine,
    rawLine: context.rawLine,
    raw: context.outerRaw,
    timestamp: typeof context.outerRaw.timestamp === "string" ? context.outerRaw.timestamp : undefined,
    tool
  };
}

export function normalizeCodexToolResult(context: CodexToolItemContext): NormalizedMessage {
  const callId = typeof context.payload.call_id === "string" ? context.payload.call_id : undefined;
  const output = typeof context.payload.output === "string" ? context.payload.output : safeJson(context.payload.output);
  const tool: MessageToolInfo = {
    toolResultFor: callId,
    isToolResult: true
  };

  return {
    id: context.id,
    role: "tool",
    content: `[tool_result${callId ? ` ${callId}` : ""}] ${output}`,
    source: "codex-jsonl",
    sourceLine: context.sourceLine,
    rawLine: context.rawLine,
    raw: context.outerRaw,
    timestamp: typeof context.outerRaw.timestamp === "string" ? context.outerRaw.timestamp : undefined,
    tool
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
