import { parseClaudeCodeJsonl } from "../adapters/claude-code-jsonl.js";
import { parseOpenAiJsonl } from "../adapters/openai-jsonl.js";
import { parseJsonlRecords } from "./diagnostics.js";
import { resolveAnalysisOptions, type AnalysisOptions } from "./options.js";
import { applySafetyRules } from "./safety.js";
import { scoreMessages } from "./scorer.js";
import { ApproxTokenizer } from "./tokenizer.js";
import type { NormalizedMessage } from "../types/message.js";

export function analyzeMessages(messages: NormalizedMessage[], options: AnalysisOptions = {}): NormalizedMessage[] {
  const resolved = resolveAnalysisOptions(options);
  const tokenizer = new ApproxTokenizer();
  const withTokens = messages.map((message) => ({
    ...message,
    tokens: tokenizer.countMessage(message.content)
  }));
  return scoreMessages(applySafetyRules(withTokens, resolved), resolved);
}

export function parseJsonl(input: string, file = "<input>"): NormalizedMessage[] {
  const records = parseJsonlRecords(input, file).slice(0, 25).map((record) => record.raw);

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
