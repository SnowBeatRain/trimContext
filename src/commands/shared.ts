import { compressFile } from "../core/compressor.js";
import { assertDifferentFiles } from "../platform/files.js";
import type { AnalysisOptions } from "../core/options.js";

export interface CliAnalysisOptions {
  recentWindow?: string;
  removeThreshold?: string;
  compressThreshold?: string;
}

export function parseAnalysisOptions(options: CliAnalysisOptions): AnalysisOptions {
  return {
    recentWindow: parseOptionalInteger(options.recentWindow, "recent-window"),
    removeThreshold: parseOptionalNumber(options.removeThreshold, "remove-threshold"),
    compressThreshold: parseOptionalNumber(options.compressThreshold, "compress-threshold")
  };
}

function parseOptionalInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  if (parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be between 0 and 1`);
  }
  return parsed;
}

export function resolveInputFile(file: string | undefined): string {
  const inputFile = file ?? process.env.TRIMCTX_TRANSCRIPT_PATH;
  if (!inputFile) {
    throw new Error("file argument is required unless TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session");
  }
  return inputFile;
}

export async function writeCompressionResult(inputFile: string, outputFile: string, options: AnalysisOptions): Promise<void> {
  await assertDifferentFiles(inputFile, outputFile, "Output file must be different from input file");
  const result = await compressFile(inputFile, outputFile, options);
  process.stdout.write(`${JSON.stringify({ output: outputFile, summary: result.report.summary }, null, 2)}\n`);
}
