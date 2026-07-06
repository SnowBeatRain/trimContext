import type { Command } from "commander";
import { formatUserSummary } from "../cli/format-summary.js";
import { analyzeFile, resolveCurrentSessionFile } from "../core/session.js";

export function registerDefaultCommand(program: Command): void {
  program
    .option("--color", "Colorize output for terminal.")
    .action(async (options: { color?: boolean }) => {
      const file = await resolveCurrentSessionFile("auto");
      const report = await analyzeFile(file, {});
      process.stdout.write(formatUserSummary(report, { color: options.color }));
    });
}
