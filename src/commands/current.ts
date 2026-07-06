import type { Command } from "commander";
import { formatAnalysisSummary } from "../cli/format-summary.js";
import { analyzeFile, findLatestSession, parseSessionSource } from "../core/session.js";
import { parseAnalysisOptions, writeCompressionResult, type CliAnalysisOptions } from "./shared.js";

export function registerCurrentCommand(program: Command): void {
  program
    .command("current")
    .option("--source <source>", "Session source to scan: auto, claude, or codex.", "auto")
    .option("--json", "Print the full JSON analysis report.")
    .option("--color", "Colorize output for terminal.")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .option("--compress <output.jsonl>", "Compress the latest matching session to a file.")
    .description("Analyze the most recent Claude Code or Codex JSONL session.")
    .action(async (options: CliAnalysisOptions & { source?: string; json?: boolean; color?: boolean; compress?: string }) => {
      const source = parseSessionSource(options.source);
      const file = await findLatestSession(source);
      const analysisOptions = parseAnalysisOptions(options);
      if (options.compress) {
        await writeCompressionResult(file, options.compress, analysisOptions);
        return;
      }
      const report = await analyzeFile(file, analysisOptions);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatAnalysisSummary(report, { color: options.color }));
    });
}
