import { open } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { createReport } from "./reporter.js";
import { isCompactBoundaryMessage } from "./signals/context.js";
import { assertDifferentFiles, writeFileDistinctFromInput } from "../platform/files.js";
import type { AnalysisOptions } from "./options.js";
import type { AnalysisReport } from "../types/report.js";
import type { NormalizedMessage } from "../types/message.js";
import { isHighDecisive } from "./rot-metrics.js";

export interface CompressResult {
  removedMessages: number;
  report: AnalysisReport;
}

export async function compressFile(
  inputFile: string,
  outputFile: string,
  options: AnalysisOptions = {}
): Promise<CompressResult> {
  await assertDifferentFiles(inputFile, outputFile, "Output file must be different from input file");
  const inputHandle = await open(inputFile, "r");
  try {
    const input = await inputHandle.readFile("utf8");
    const parsed = parseJsonl(input, inputFile);
    const analyzed = analyzeMessages(parsed, options);
    const report = createReport(analyzed, inputFile);
    // Only non-protected remove candidates are eligible for physical deletion in the output copy.
    const removeIds = new Set(
      analyzed
        .filter(canRemoveFromCompressedCopy)
        .map((message) => message.id)
    );

    const output = parsed[0]?.source === "openai-jsonl"
      ? compressOpenAiLines(input, analyzed, removeIds)
      : compressJsonlLines(input, analyzed, removeIds);

    await writeFileDistinctFromInput(
      inputHandle,
      outputFile,
      output,
      "Output file must be different from input file"
    );
    return { removedMessages: removeIds.size, report };
  } finally {
    await inputHandle.close();
  }
}

function compressJsonlLines(input: string, analyzed: NormalizedMessage[], removeIds: Set<string>): string {
  const byLine = messagesBySourceLine(analyzed);
  // Claude/Codex records map one normalized message to a line, so dropping a candidate drops that line.
  // Unrecognized non-empty rows are kept byte-for-byte because they have no normalized messages.
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .filter(({ sourceLine }) => {
      const messages = byLine.get(sourceLine) ?? [];
      return messages.length === 0 || messages.some((message) => !removeIds.has(message.id) || isCompactBoundaryMessage(message));
    })
    .map(({ line }) => line)
    .join("\n");
}

export function canRemoveFromCompressedCopy(message: NormalizedMessage): boolean {
  return !isCompactBoundaryMessage(message) &&
    !message.protected &&
    message.decision === "remove_candidate" &&
    (message.reasons?.length ?? 0) > 0 &&
    isHighDecisive(message);
}

function compressOpenAiLines(input: string, analyzed: NormalizedMessage[], removeIds: Set<string>): string {
  const byLine = messagesBySourceLine(analyzed);

  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .flatMap(({ line, sourceLine }) => {
      const messages = byLine.get(sourceLine) ?? [];
      if (messages.length === 0) return [line];
      const raw = JSON.parse(line) as Record<string, unknown>;
      if (Array.isArray(raw.messages)) {
        // OpenAI batch rows may contain many messages; remove array entries without rewriting unrelated rows.
        const bySourceIndex = new Map(messages.map((message) => [message.sourceIndex, message]));
        const kept = raw.messages.filter((_, index) => !removeIds.has(bySourceIndex.get(index)?.id ?? ""));
        if (kept.length === 0) return [];
        return [JSON.stringify({ ...raw, messages: kept })];
      }
      return removeIds.has(messages[0].id) ? [] : [line];
    })
    .join("\n");
}

function messagesBySourceLine(analyzed: NormalizedMessage[]): Map<number, NormalizedMessage[]> {
  const byLine = new Map<number, NormalizedMessage[]>();
  for (const message of analyzed) {
    const list = byLine.get(message.sourceLine) ?? [];
    list.push(message);
    byLine.set(message.sourceLine, list);
  }
  return byLine;
}
