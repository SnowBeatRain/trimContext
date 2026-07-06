import type { Command } from "commander";
import { formatAnalysisSummary } from "../cli/format-summary.js";
import { analyzeFile } from "../core/session.js";
import { parseAnalysisOptions, resolveInputFile, type CliAnalysisOptions } from "./shared.js";

export function registerAnalyzeCommand(program: Command): void {
  program
    .command("analyze")
    .argument("[file]")
    .option("--json", "Print the full JSON analysis report.")
    .option("--color", "Colorize output for terminal.")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Analyze a Claude Code, OpenAI, or Codex/Hermes JSONL conversation.")
    .action(async (file: string | undefined, options: CliAnalysisOptions & { json?: boolean; color?: boolean }) => {
      const inputFile = resolveInputFile(file);
      const report = await analyzeFile(inputFile, parseAnalysisOptions(options));
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatAnalysisSummary(report, { color: options.color }));
    });
}
