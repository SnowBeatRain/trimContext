import type { Command } from "commander";
import { writeCompressionResult } from "./shared.js";

export function registerCompressCommand(program: Command): void {
  program
    .command("compress")
    .argument("<file>")
    .requiredOption("-o, --output <output.jsonl>")
    .description("Write a safe compressed JSONL copy without modifying the original.")
    .action(async (file: string, options: { output: string }) => {
      await writeCompressionResult(file, options.output);
    });
}
