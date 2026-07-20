import type { Command } from "commander";
import { parseAnalysisOptions, writeCompressionResult, type CliAnalysisOptions } from "./shared.js";

export function registerCompressCommand(program: Command): void {
  program
    .command("compress")
    .argument("<file>")
    .requiredOption("-o, --output <output.jsonl>")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Write a safe compressed JSONL copy without modifying the original.")
    .action(async (file: string, options: CliAnalysisOptions & { output: string }) => {
      await writeCompressionResult(file, options.output, parseAnalysisOptions(options));
    });
}
