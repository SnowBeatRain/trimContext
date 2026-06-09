#!/usr/bin/env node
import { Command } from "commander";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { analyzeMessages, parseJsonl } from "./core/analyzer.js";
import { compressFile } from "./core/compressor.js";
import { createReport } from "./core/reporter.js";
import { formatAnalysisSummary } from "./cli/format-summary.js";
import type { AnalysisOptions } from "./core/options.js";

const program = new Command();

program
  .name("trimctx")
  .description("Analyze and safely trim long AI conversation context.")
  .version("0.1.0");

program
  .command("resume")
  .option("--json", "Print the full JSON analysis report.")
  .option("--color", "Colorize output for terminal.")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .option("--compress <output.jsonl>", "Compress the latest session to a file.")
  .description("Analyze the most recent Claude Code session.")
  .action(async (options: CliAnalysisOptions & { json?: boolean; color?: boolean; compress?: string }) => {
    const file = await findLatestSession();
    const analysisOptions = parseAnalysisOptions(options);
    if (options.compress) {
      const result = await compressFile(file, options.compress, analysisOptions);
      process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
      return;
    }
    const report = await analyzeFile(file, analysisOptions);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatAnalysisSummary(report, { color: options.color }));
  });

program
  .command("analyze")
  .argument("<file>")
  .option("--json", "Print the full JSON analysis report.")
  .option("--color", "Colorize output for terminal.")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .description("Analyze a Claude Code or OpenAI JSONL conversation.")
  .action(async (file: string, options: CliAnalysisOptions & { json?: boolean; color?: boolean }) => {
    const report = await analyzeFile(file, parseAnalysisOptions(options));
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(formatAnalysisSummary(report, { color: options.color }));
  });

program
  .command("report")
  .argument("<file>")
  .requiredOption("-o, --output <report.json>")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .description("Write a JSON analysis report.")
  .action(async (file: string, options: CliAnalysisOptions & { output: string }) => {
    const report = await analyzeFile(file, parseAnalysisOptions(options));
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  });

program
  .command("compress")
  .argument("<file>")
  .requiredOption("-o, --output <output.jsonl>")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .description("Write a safe compressed JSONL copy without modifying the original.")
  .action(async (file: string, options: CliAnalysisOptions & { output: string }) => {
    const result = await compressFile(file, options.output, parseAnalysisOptions(options));
    process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trimctx: ${message}\n`);
  process.exitCode = 1;
});

async function findLatestSession(): Promise<string> {
  const claudeDir = join(homedir(), ".claude", "projects");
  let latestFile = "";
  let latestMtime = 0;

  const projectDirs = await readdir(claudeDir);
  for (const dir of projectDirs) {
    const projectPath = join(claudeDir, dir);
    try {
      const entries = await readdir(projectPath);
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const fullPath = join(projectPath, entry);
        const s = await stat(fullPath);
        if (s.mtimeMs > latestMtime) {
          latestMtime = s.mtimeMs;
          latestFile = fullPath;
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  if (!latestFile) {
    throw new Error("no session files found in ~/.claude/projects/");
  }
  return latestFile;
}

interface CliAnalysisOptions {
  recentWindow?: string;
  removeThreshold?: string;
  compressThreshold?: string;
}

function parseAnalysisOptions(options: CliAnalysisOptions): AnalysisOptions {
  return {
    recentWindow: parseOptionalInteger(options.recentWindow, "recent-window"),
    removeThreshold: parseOptionalNumber(options.removeThreshold, "remove-threshold"),
    compressThreshold: parseOptionalNumber(options.compressThreshold, "compress-threshold")
  };
}

function parseOptionalInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  return parsed;
}

async function analyzeFile(file: string, options: AnalysisOptions = {}) {
  const input = await readFile(file, "utf8");
  return createReport(analyzeMessages(parseJsonl(input, file), options), file);
}
