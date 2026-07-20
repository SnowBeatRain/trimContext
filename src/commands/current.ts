import type { Command } from "commander";
import { formatAnalysisSummary } from "../cli/format-summary.js";
import { analyzeFile } from "../core/pipeline.js";
import { resolveBoundSessionFile } from "../sessions/discovery.js";

export function registerCurrentCommand(program: Command): void {
  program
    .command("current")
    .option("--json", "Print the full JSON analysis report.")
    .option("--color", "Colorize output for terminal.")
    .description("Analyze the transcript bound to the current AI client window.")
    .action(async (options: { json?: boolean; color?: boolean }) => {
      const file = await resolveBoundSessionFile();
      const report = await analyzeFile(file, {});
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatAnalysisSummary(report, { color: options.color }));
    });
}
