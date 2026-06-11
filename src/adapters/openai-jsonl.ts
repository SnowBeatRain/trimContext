import { flattenContent, isRecord, normalizeRole } from "./content.js";
import { parseJsonlRecords } from "../core/diagnostics.js";
import type { NormalizedMessage } from "../types/message.js";

export function parseOpenAiJsonl(input: string, file = "<input>"): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];

  parseJsonlRecords(input, file).forEach(({ raw, line, sourceLine }) => {
      if (!isRecord(raw)) {
        throw new Error(`Invalid OpenAI JSONL record at line ${sourceLine}`);
      }

      if (Array.isArray(raw.messages)) {
        raw.messages.forEach((entry, messageIndex) => {
          const normalized = normalizeOpenAiMessage(entry, line, sourceLine, `${file}:${sourceLine}:${messageIndex + 1}`);
          if (normalized) {
            messages.push({ ...normalized, sourceIndex: messageIndex });
          }
        });
        return;
      }
      const normalized = normalizeOpenAiMessage(raw, line, sourceLine, `${file}:${sourceLine}`);
      if (normalized) {
        messages.push(normalized);
      }
    });

  return messages;
}

function normalizeOpenAiMessage(raw: unknown, rawLine: string, sourceLine: number, id: string): NormalizedMessage | null {
  if (!isRecord(raw)) {
    return null;
  }
  const flattened = flattenContent(raw.content);
  const role = normalizeRole(raw.role);

  return {
    id,
    role,
    content: flattened.text,
    source: "openai-jsonl",
    sourceLine,
    rawLine,
    raw,
    tool: role === "tool" ? { ...flattened.tool, isToolResult: true } : flattened.tool
  };
}
