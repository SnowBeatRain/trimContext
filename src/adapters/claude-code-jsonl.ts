import { flattenContent, isRecord, normalizeRole } from "./content.js";
import type { NormalizedMessage } from "../types/message.js";

export function parseClaudeCodeJsonl(input: string, file = "<input>"): NormalizedMessage[] {
  const entries = input
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);

  const results: NormalizedMessage[] = [];
  const seenMessageIds = new Map<string, number>();

  for (const { line, sourceLine } of entries) {
    const parsed = parseLine(line, sourceLine, file);
    const raw = parsed.raw as Record<string, unknown> | undefined;
    const messageId = isRecord(raw?.message) ? String(raw!.message.id ?? "") : "";

    if (messageId) {
      const prevIndex = seenMessageIds.get(messageId);
      if (prevIndex !== undefined) {
        if (isRecord(raw?.message) && raw!.message.usage) {
          results[prevIndex] = parsed;
        }
        continue;
      }
      seenMessageIds.set(messageId, results.length);
    }

    results.push(parsed);
  }

  return results;
}

function parseLine(line: string, sourceLine: number, file: string): NormalizedMessage {
  const raw: unknown = JSON.parse(line);
  if (!isRecord(raw)) {
    throw new Error(`Invalid Claude Code JSONL record at line ${sourceLine}`);
  }

  const message = isRecord(raw.message) ? raw.message : undefined;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const isMeta = type === "user" && raw.isMeta === true;
  const role = type === "system" || isMeta ? "system" : normalizeRole(message?.role, normalizeRole(type));
  let flattened = message
    ? flattenContent(message.content ?? raw.content)
    : flattenClaudeMetadata(raw, type);

  if (isMeta) {
    flattened = { ...flattened, text: `[isMeta] ${flattened.text}` };
  }

  return {
    id: typeof raw.uuid === "string" ? raw.uuid : `${file}:${sourceLine}`,
    role,
    content: flattened.text,
    source: "claude-code-jsonl",
    sourceLine,
    rawLine: line,
    raw,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
    parentId: typeof raw.parentUuid === "string" ? raw.parentUuid : undefined,
    tool: flattened.tool
  };
}

function flattenClaudeMetadata(raw: Record<string, unknown>, type: string | undefined): ReturnType<typeof flattenContent> {
  if (type === "mode") {
    return { text: `[mode] ${String(raw.mode ?? "")}`.trim() };
  }
  if (type === "permission-mode") {
    return { text: `[permission-mode] ${String(raw.permissionMode ?? "")}`.trim() };
  }
  if (type === "attachment" && "attachment" in raw) {
    return { text: `[attachment] ${safeJson(raw.attachment)}` };
  }
  if (type === "last-prompt") {
    return { text: `[last-prompt] ${String(raw.lastPrompt ?? "")}`.trim() };
  }
  return { text: `[${type ?? "metadata"}] ${safeJson(raw)}` };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
