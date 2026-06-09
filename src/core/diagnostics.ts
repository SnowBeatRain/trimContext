import type { NormalizedMessage } from "../types/message.js";

export interface JsonlRecord {
  raw: unknown;
  line: string;
  sourceLine: number;
}

export function parseJsonlRecords(input: string, file = "<input>"): JsonlRecord[] {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, sourceLine }) => ({
      line,
      sourceLine,
      raw: parseJsonlLine(line, sourceLine, file)
    }));
}

export function createAnalysisWarnings(messages: NormalizedMessage[]): string[] {
  const warnings = [
    "Token counts are approximate local estimates, not model-specific tokenizer counts."
  ];

  if (messages.some((message) => message.decision === "compress_candidate")) {
    warnings.push(
      "compress_candidate messages are report-only in this version and are kept during compression."
    );
  }

  return warnings;
}

function parseJsonlLine(line: string, sourceLine: number, file: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSONL at ${file}:${sourceLine}: ${detail}`);
  }
}
