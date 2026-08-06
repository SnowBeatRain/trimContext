import { open } from "node:fs/promises";
import { extname } from "node:path";
import type { Command } from "commander";
import { assertPhase0InputSha256 } from "../core/input-integrity.js";
import { analyzeInput } from "../core/pipeline.js";
import { formatReportMarkdown } from "../core/report-markdown.js";
import { assertDifferentFiles, atomicWriteFileDistinctFromInput } from "../platform/files.js";

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .argument("<file>")
    .requiredOption("-o, --output <report.json|report.md>")
    .description("Write a Markdown or JSON analysis report.")
    .action(async (file: string, options: { output: string }) => {
      await assertDifferentFiles(file, options.output, "Output file must be different from input file");
      const extension = extname(options.output).toLowerCase();
      if (extension !== ".json" && extension !== ".md") {
        throw new Error("report output must end in .json or .md");
      }
      const inputHandle = await open(file, "r");
      try {
        const input = await inputHandle.readFile();
        assertPhase0InputSha256(input);
        const report = analyzeInput(input.toString("utf8"), file, {});
        const output = extension === ".md"
          ? formatReportMarkdown(report)
          : `${JSON.stringify(report, null, 2)}\n`;
        await atomicWriteFileDistinctFromInput(
          inputHandle,
          options.output,
          output,
          "Output file must be different from input file"
        );
      } finally {
        await inputHandle.close();
      }
    });
}
