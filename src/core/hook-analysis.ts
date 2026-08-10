import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { createReport } from "./reporter.js";
import type { NormalizedMessage } from "../types/message.js";
import type { AnalysisReport } from "../types/report.js";

const LAST_ASSISTANT_MESSAGE_ID = "trimctx:hook:last-assistant-message";
export const MAX_HOOK_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
export const MAX_HOOK_TRANSCRIPT_MESSAGES = 10_000;
const HOOK_TRANSCRIPT_READ_CHUNK_BYTES = 64 * 1024;

export async function analyzeClaudeStopFile(
  file: string,
  lastAssistantMessage?: string
): Promise<AnalysisReport> {
  const handle = await open(file, "r");
  try {
    const snapshot = await handle.stat();
    if (!snapshot.isFile()) {
      throw new Error(`Claude Stop transcript must be a regular file: ${file}`);
    }
    if (snapshot.size > MAX_HOOK_TRANSCRIPT_BYTES) {
      throw new Error(`Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_BYTES} bytes: ${file}`);
    }

    const input = await readBoundedFile(handle, MAX_HOOK_TRANSCRIPT_BYTES);
    if (input.byteLength > MAX_HOOK_TRANSCRIPT_BYTES) {
      throw new Error(`Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_BYTES} bytes: ${file}`);
    }

    const parsed = parseJsonl(input.toString("utf8"), file);
    const messages = supplementLastAssistantMessage(parsed, lastAssistantMessage);
    if (messages.length > MAX_HOOK_TRANSCRIPT_MESSAGES) {
      throw new Error(
        `Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_MESSAGES} normalized messages`
      );
    }
    return createReport(analyzeMessages(messages), file);
  } finally {
    await handle.close();
  }
}

async function readBoundedFile(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (totalBytes <= maxBytes) {
    const length = Math.min(HOOK_TRANSCRIPT_READ_CHUNK_BYTES, maxBytes + 1 - totalBytes);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, totalBytes);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    totalBytes += bytesRead;
  }

  return Buffer.concat(chunks, totalBytes);
}

function supplementLastAssistantMessage(
  messages: NormalizedMessage[],
  lastAssistantMessage: string | undefined
): NormalizedMessage[] {
  const comparable = comparableText(lastAssistantMessage ?? "");
  if (!comparable) return messages;

  const latest = latestAssistant(messages);
  if (latest && comparableText(latest.content) === comparable) return messages;

  const boundary = messages.at(-1);
  const sourceLine = boundary?.sourceLine ?? 1;
  const raw = {
    type: "assistant",
    message: { role: "assistant", content: lastAssistantMessage },
    trimctxSource: "last_assistant_message"
  };

  return [
    ...messages,
    {
      id: uniqueMessageId(messages, sourceLine),
      role: "assistant",
      content: lastAssistantMessage!,
      source: boundary?.source ?? "claude-code-jsonl",
      sourceLine,
      rawLine: "",
      raw,
      sessionId: latestSessionId(messages)
    }
  ];
}

function comparableText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function latestAssistant(messages: NormalizedMessage[]): NormalizedMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "assistant") return messages[index];
  }
  return undefined;
}

function latestSessionId(messages: NormalizedMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionId = messages[index]!.sessionId;
    if (sessionId) return sessionId;
  }
  return undefined;
}

function uniqueMessageId(messages: NormalizedMessage[], sourceLine: number): string {
  const ids = new Set(messages.map((message) => message.id));
  const base = `${LAST_ASSISTANT_MESSAGE_ID}:${sourceLine}`;
  if (!ids.has(base)) return base;

  let suffix = 2;
  while (ids.has(`${base}:${suffix}`)) suffix += 1;
  return `${base}:${suffix}`;
}
