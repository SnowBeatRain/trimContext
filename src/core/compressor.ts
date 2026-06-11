import { readFile, stat, writeFile } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { createReport } from "./reporter.js";
import type { AnalysisOptions } from "./options.js";
import type { AnalysisReport } from "../types/report.js";
import type { NormalizedMessage } from "../types/message.js";

export interface CompressResult {
  removedMessages: number;
  report: AnalysisReport;
}

export async function compressFile(inputFile: string, outputFile: string, options: AnalysisOptions = {}): Promise<CompressResult> {
  if (await sameFile(inputFile, outputFile)) {
    throw new Error("Output file must be different from input file");
  }

  const input = await readFile(inputFile, "utf8");
  const parsed = parseJsonl(input, inputFile);
  const analyzed = analyzeMessages(parsed, options);
  const report = createReport(analyzed, inputFile);
  const removeIds = new Set(
    analyzed
      .filter((message) => message.decision === "remove_candidate" && !message.protected)
      .map((message) => message.id)
  );

  const output = parsed[0]?.source === "openai-jsonl"
    ? compressOpenAiLines(input, analyzed, removeIds)
    : compressJsonlLines(input, analyzed, removeIds);

  await writeFile(outputFile, output, "utf8");
  return { removedMessages: removeIds.size, report };
}

function compressJsonlLines(input: string, analyzed: NormalizedMessage[], removeIds: Set<string>): string {
  const byLine = messagesBySourceLine(analyzed);
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ line, sourceLine: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .filter(({ sourceLine }) => {
      const messages = byLine.get(sourceLine) ?? [];
      return messages.length === 0 || messages.some((message) => !removeIds.has(message.id));
    })
    .map(({ line }) => line)
    .join("\n");
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
        const kept = raw.messages.filter((_, index) => !removeIds.has(messages[index]?.id ?? ""));
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

async function sameFile(inputFile: string, outputFile: string): Promise<boolean> {
  try {
    const [inputStat, outputStat] = await Promise.all([stat(inputFile), stat(outputFile)]);
    return inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino;
  } catch {
    return inputFile === outputFile;
  }
}
