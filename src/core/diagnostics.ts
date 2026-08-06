import type { NormalizedMessage } from "../types/message.js";
import { isCompactBoundaryMessage } from "./signals/context.js";

export interface AnalysisWarningDiagnostic {
  text: string;
  affectsObservability: boolean;
}

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
  return createAnalysisWarningDiagnostics(messages).map((warning) => warning.text);
}

export function createReportWarningDiagnostics(
  messages: NormalizedMessage[]
): AnalysisWarningDiagnostic[] {
  return [
    ...createCompactionWarningDiagnostics(messages),
    ...createAnalysisWarningDiagnostics(messages)
  ];
}

function createCompactionWarningDiagnostics(
  messages: NormalizedMessage[]
): AnalysisWarningDiagnostic[] {
  const compactSubtypes = messages.flatMap((message) => {
    const raw = message.raw as Record<string, unknown> | undefined;
    if (!raw || !isCompactBoundaryMessage(message)) return [];
    if (raw.type === "compacted") return ["compacted"];
    return [String(raw.subtype)];
  });

  if (compactSubtypes.length === 0) return [];
  const uniqueSubtypes = [...new Set(compactSubtypes)].sort();
  return [{
    text: `session_compacted: ${compactSubtypes.length} compact event(s) detected (${uniqueSubtypes.join(", ")}) \u2014 conversation was previously compressed`,
    affectsObservability: true
  }];
}

function createAnalysisWarningDiagnostics(
  messages: NormalizedMessage[]
): AnalysisWarningDiagnostic[] {
  const warnings: AnalysisWarningDiagnostic[] = [];

  if (messages.some((message) => message.token_metadata?.estimated !== false)) {
    warnings.push({
      text: "Token counts are approximate local estimates, not model-specific tokenizer counts.",
      affectsObservability: true
    });
  }

  if (messages.some((message) => message.decision === "compress_candidate")) {
    warnings.push({
      text: "compress_candidate messages are report-only in this version and are kept during compression.",
      affectsObservability: false
    });
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
