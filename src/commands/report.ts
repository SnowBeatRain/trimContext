import { open } from "node:fs/promises";
import type { Command } from "commander";
import { analyzeInput } from "../core/pipeline.js";
import { assertDifferentFiles, writeFileDistinctFromInput } from "../platform/files.js";
import { parseAnalysisOptions, type CliAnalysisOptions } from "./shared.js";

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .argument("<file>")
    .requiredOption("-o, --output <report.json>")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Write a JSON analysis report.")
    .action(async (file: string, options: CliAnalysisOptions & { output: string }) => {
      await assertDifferentFiles(file, options.output, "Output file must be different from input file");
      const inputHandle = await open(file, "r");
      try {
        const report = analyzeInput(
          await inputHandle.readFile("utf8"),
          file,
          parseAnalysisOptions(options)
        );
        await writeFileDistinctFromInput(
          inputHandle,
          options.output,
          `${JSON.stringify(report, null, 2)}\n`,
          "Output file must be different from input file"
        );
      } finally {
        await inputHandle.close();
      }
    });
}
