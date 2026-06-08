import { parseClaudeCodeJsonl } from "../adapters/claude-code-jsonl.js";
import { parseOpenAiJsonl } from "../adapters/openai-jsonl.js";
import { applySafetyRules } from "./safety.js";
import { scoreMessages } from "./scorer.js";
import { ApproxTokenizer } from "./tokenizer.js";
import type { NormalizedMessage } from "../types/message.js";

export function analyzeMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const tokenizer = new ApproxTokenizer();
  const withTokens = messages.map((message) => ({
    ...message,
    tokens: tokenizer.countMessage(message.content)
  }));
  return scoreMessages(applySafetyRules(withTokens));
}

export function parseJsonl(input: string, file = "<input>"): NormalizedMessage[] {
  const records = input
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 25)
    .map((line) => JSON.parse(line) as unknown);

  if (records.length === 0) return [];

  for (const raw of records) {
    if (typeof raw === "object" && raw !== null) {
      const record = raw as Record<string, unknown>;
      if (looksLikeClaudeCodeRecord(record)) {
        return parseClaudeCodeJsonl(input, file);
      }
      if ("messages" in record || "role" in record) {
        return parseOpenAiJsonl(input, file);
      }
    }
  }

  throw new Error("Unsupported JSONL format");
}

function looksLikeClaudeCodeRecord(record: Record<string, unknown>): boolean {
  const type = record.type;
  return (
    typeof type === "string" &&
    ("sessionId" in record || "uuid" in record || "message" in record || "attachment" in record)
  );
}
