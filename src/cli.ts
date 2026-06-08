#!/usr/bin/env node
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { analyzeMessages, parseJsonl } from "./core/analyzer.js";
import { compressFile } from "./core/compressor.js";
import { createReport } from "./core/reporter.js";
import { formatAnalysisSummary } from "./cli/format-summary.js";

const program = new Command();

program
  .name("trimctx")
  .description("Analyze and safely trim long AI conversation context.")
  .version("0.1.0");

program
  .command("analyze")
  .argument("<file>")
  .option("--json", "Print the full JSON analysis report.")
  .description("Analyze a Claude Code or OpenAI JSONL conversation.")
  .action(async (file: string, options: { json?: boolean }) => {
    const report = await analyzeFile(file);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatAnalysisSummary(report));
  });

program
  .command("report")
  .argument("<file>")
  .requiredOption("-o, --output <report.json>")
  .description("Write a JSON analysis report.")
  .action(async (file: string, options: { output: string }) => {
    const report = await analyzeFile(file);
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  });

program
  .command("compress")
  .argument("<file>")
  .requiredOption("-o, --output <output.jsonl>")
  .description("Write a safe compressed JSONL copy without modifying the original.")
  .action(async (file: string, options: { output: string }) => {
    const result = await compressFile(file, options.output);
    process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trimctx: ${message}\n`);
  process.exitCode = 1;
});

async function analyzeFile(file: string) {
  const input = await readFile(file, "utf8");
  return createReport(analyzeMessages(parseJsonl(input, file)), file);
}
