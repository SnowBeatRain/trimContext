import { compressFile } from "../core/compressor.js";
import { assertDifferentFiles } from "../platform/files.js";

export function resolveInputFile(file: string | undefined): string {
  const inputFile = file ?? process.env.TRIMCTX_TRANSCRIPT_PATH;
  if (!inputFile) {
    throw new Error("file argument is required unless TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session");
  }
  return inputFile;
}

export async function writeCompressionResult(inputFile: string, outputFile: string): Promise<void> {
  await assertDifferentFiles(inputFile, outputFile, "Output file must be different from input file");
  const result = await compressFile(inputFile, outputFile, {});
  process.stdout.write(`${JSON.stringify({ output: outputFile, summary: result.report.summary }, null, 2)}\n`);
}
