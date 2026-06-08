#!/usr/bin/env node
import { Command } from "commander";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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
  .command("resume")
  .option("--json", "Print the full JSON analysis report.")
  .option("--color", "Colorize output for terminal.")
  .option("--compress <output.jsonl>", "Compress the latest session to a file.")
  .description("Analyze the most recent Claude Code session.")
  .action(async (options: { json?: boolean; color?: boolean; compress?: string }) => {
    const file = await findLatestSession();
    if (options.compress) {
      const result = await compressFile(file, options.compress);
      process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
      return;
    }
    const report = await analyzeFile(file);
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
  .description("Analyze a Claude Code or OpenAI JSONL conversation.")
  .action(async (file: string, options: { json?: boolean; color?: boolean }) => {
    const report = await analyzeFile(file);
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

async function analyzeFile(file: string) {
  const input = await readFile(file, "utf8");
  return createReport(analyzeMessages(parseJsonl(input, file)), file);
}
