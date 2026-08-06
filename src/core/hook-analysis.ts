import { readFile } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { createReport } from "./reporter.js";
import type { NormalizedMessage } from "../types/message.js";
import type { AnalysisReport } from "../types/report.js";

const LAST_ASSISTANT_MESSAGE_ID = "trimctx:hook:last-assistant-message";

export async function analyzeClaudeStopFile(
  file: string,
  lastAssistantMessage?: string
): Promise<AnalysisReport> {
  const input = await readFile(file, "utf8");
  const parsed = parseJsonl(input, file);
  const messages = supplementLastAssistantMessage(parsed, lastAssistantMessage);
  return createReport(analyzeMessages(messages), file);
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
