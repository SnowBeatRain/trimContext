import { flattenContent, isRecord, normalizeRole } from "./content.js";
import { normalizeCodexToolResult, normalizeCodexToolUse } from "./codex-tool-items.js";
import { parseJsonlRecords } from "../core/diagnostics.js";
import type { NormalizedMessage, MessageRole } from "../types/message.js";

/**
 * Parse Codex CLI JSONL (rollout format).
 *
 * Each line is {timestamp, type, payload} where type ∈
 * session_meta | event_msg | response_item | turn_context | compacted.
 *
 * session_meta with base_instructions → system message
 * response_item subtypes:
 *   message/{developer,user,assistant}  → direct messages
 *   function_call / custom_tool_call    → assistant tool_use
 *   function_call_output / custom_tool_call_output → tool results
 *   reasoning                           → skipped (encrypted/internal)
 */
export function parseCodexJsonl(input: string, file = "<input>"): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];

  for (const { raw, line, sourceLine } of parseJsonlRecords(input, file)) {
    if (!isRecord(raw)) {
      throw new Error(`Invalid Codex JSONL record at line ${sourceLine}`);
    }

    if (raw.type === "session_meta") {
      const normalized = normalizeSessionMeta(raw, line, sourceLine, file);
      if (normalized) {
        messages.push(normalized);
      }
      continue;
    }

    // Only response_item carries conversation content after session metadata.
    if (raw.type !== "response_item") {
      continue;
    }

    const payload = isRecord(raw.payload) ? raw.payload : raw;
    const normalized = normalizeResponseItem(payload, raw, line, sourceLine, file);
    if (normalized) {
      messages.push(normalized);
    }
  }

  return messages;
}

function normalizeSessionMeta(
  raw: Record<string, unknown>,
  rawLine: string,
  sourceLine: number,
  file: string,
): NormalizedMessage | null {
  const payload = isRecord(raw.payload) ? raw.payload : raw;
  const baseInstructions = isRecord(payload.base_instructions) ? payload.base_instructions : undefined;
  const text = typeof baseInstructions?.text === "string" ? baseInstructions.text : undefined;
  if (!text) {
    return null;
  }

  return {
    id: buildId(raw, sourceLine, file),
    role: "system",
    content: text,
    source: "codex-jsonl",
    sourceLine,
    rawLine,
    raw,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    sessionId: typeof payload.id === "string" ? payload.id : undefined,
  };
}

function normalizeResponseItem(
  payload: Record<string, unknown>,
  outerRaw: Record<string, unknown>,
  rawLine: string,
  sourceLine: number,
  file: string,
): NormalizedMessage | null {
  const subtype = typeof payload.type === "string" ? payload.type : "";
  const role = typeof payload.role === "string" ? payload.role : "";

  // reasoning blocks are encrypted/internal — skip
  if (subtype === "reasoning") {
    return null;
  }

  // --- message (developer / user / assistant) ---
  if (subtype === "message") {
    const mappedRole: MessageRole =
      role === "developer" ? "system" : normalizeRole(role);
    const flattened = flattenContent(payload.content);

    return {
      id: buildId(outerRaw, sourceLine, file),
      role: mappedRole,
      content: flattened.text,
      source: "codex-jsonl",
      sourceLine,
      rawLine,
      raw: outerRaw,
      timestamp: typeof outerRaw.timestamp === "string" ? outerRaw.timestamp : undefined,
      sessionId: isRecord(outerRaw.payload) && typeof outerRaw.payload.session_id === "string"
        ? outerRaw.payload.session_id
        : undefined,
      tool: flattened.tool,
    };
  }

  const toolContext = { payload, outerRaw, rawLine, sourceLine, id: buildId(outerRaw, sourceLine, file) };

  // --- function_call / custom_tool_call → assistant tool_use ---
  if (subtype === "function_call") {
    return normalizeCodexToolUse(toolContext, "tool", "arguments");
  }

  if (subtype === "custom_tool_call") {
    return normalizeCodexToolUse(toolContext, "custom_tool", "input");
  }

  // --- function_call_output / custom_tool_call_output → tool result ---
  if (subtype === "function_call_output" || subtype === "custom_tool_call_output") {
    return normalizeCodexToolResult(toolContext);
  }

  // Unknown response_item subtype — skip gracefully
  return null;
}

function buildId(raw: Record<string, unknown>, sourceLine: number, file: string): string {
  // Prefer payload.call_id for tool items, fall back to source line
  const payload = isRecord(raw.payload) ? raw.payload : raw;
  if (typeof payload.call_id === "string") {
    return `${file}:${sourceLine}:${payload.call_id}`;
  }
  return `${file}:${sourceLine}`;
}
