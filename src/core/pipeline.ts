import { readFile } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { assertPhase0InputSha256 } from "./input-integrity.js";
import { createReport } from "./reporter.js";
import type { AnalysisOptions } from "./options.js";
import type { AnalysisReport } from "../types/report.js";

export async function analyzeFile(file: string, options: AnalysisOptions = {}): Promise<AnalysisReport> {
  const input = await readFile(file);
  assertPhase0InputSha256(input);
  return analyzeInput(input.toString("utf8"), file, options);
}

export function analyzeInput(input: string, file: string, options: AnalysisOptions = {}): AnalysisReport {
  return createReport(analyzeMessages(parseJsonl(input, file), options), file, options);
}
