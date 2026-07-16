import type { Command } from "commander";
import { open } from "node:fs/promises";
import { formatAnalysisSummary, formatUserSummary } from "../cli/format-summary.js";
import { compressFile } from "../core/compressor.js";
import type { AnalysisOptions } from "../core/options.js";
import { analyzeFile, analyzeInput } from "../core/pipeline.js";
import {
  findLatestSession,
  hasCurrentSessionBinding,
  listSessions,
  parseSessionSource,
  resolveBoundSessionFile
} from "../sessions/discovery.js";
import { isInteractiveTerminal, selectSession } from "../sessions/picker.js";
import { assertDifferentFiles, writeFileDistinctFromInput } from "../platform/files.js";
import {
  parseAnalysisOptions,
  type CliAnalysisOptions
} from "./shared/analysis-options.js";

interface AnalyzeSelectionOptions extends CliAnalysisOptions {
  json?: boolean;
  color?: boolean;
  select?: boolean;
  latest?: boolean;
  source?: string;
}

export function registerDefaultAction(program: Command): void {
  program
    .option("--color", "Colorize output for terminal.")
    .action(async (options: { color?: boolean }) => {
      const file = await resolveDefaultInput();
      const report = await analyzeFile(file, {});
      process.stdout.write(formatUserSummary(report, { color: options.color }));
    });
}

export function registerAnalysisCommands(program: Command): void {
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

  program
    .command("analyze")
    .argument("[file]")
    .option("--json", "Print the full JSON analysis report.")
    .option("--color", "Colorize output for terminal.")
    .option("--select", "Choose a local Claude Code or Codex session interactively.")
    .option("--latest", "Analyze the most recently modified local session.")
    .option("--source <source>", "Filter selection: auto, claude, or codex.")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Analyze a Claude Code, OpenAI, or Codex/Hermes JSONL conversation.")
    .action(async (file: string | undefined, options: AnalyzeSelectionOptions) => {
      const inputFile = await resolveAnalyzeInput(file, options);
      const report = await analyzeFile(inputFile, parseAnalysisOptions(options));
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

  program
    .command("compress")
    .argument("<file>")
    .requiredOption("-o, --output <output.jsonl>")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Write a safe compressed JSONL copy without modifying the original.")
    .action(async (file: string, options: CliAnalysisOptions & { output: string }) => {
      await writeCompressionResult(file, options.output, parseAnalysisOptions(options));
    });
}

async function writeCompressionResult(
  inputFile: string,
  outputFile: string,
  options: AnalysisOptions
): Promise<void> {
  await assertDifferentFiles(inputFile, outputFile, "Output file must be different from input file");
  const result = await compressFile(inputFile, outputFile, options);
  process.stdout.write(`${JSON.stringify({ output: outputFile, summary: result.report.summary }, null, 2)}\n`);
}

async function resolveDefaultInput(): Promise<string> {
  if (hasCurrentSessionBinding()) {
    return resolveBoundSessionFile();
  }
  if (!isInteractiveTerminal()) {
    throw new Error([
      "非交互环境无法选择本地会话。",
      "",
      "请显式运行：trimctx analyze <file>",
      "或分析最近会话：trimctx analyze --latest"
    ].join("\n"));
  }
  const sessions = (await listSessions("auto")).slice(0, 20);
  return (await selectSession(sessions)).file;
}

async function resolveAnalyzeInput(
  file: string | undefined,
  options: AnalyzeSelectionOptions
): Promise<string> {
  if (file && (options.select || options.latest)) {
    throw new Error("file cannot be used with --select or --latest");
  }
  if (options.select && options.latest) {
    throw new Error("--select cannot be used with --latest");
  }
  if (options.source !== undefined && !options.select && !options.latest) {
    throw new Error("--source requires --select or --latest");
  }

  if (file) return file;

  const source = parseSessionSource(options.source);
  if (options.select) {
    if (!isInteractiveTerminal()) {
      throw new Error("--select requires an interactive terminal; use a file path or --latest instead");
    }
    const sessions = (await listSessions(source)).slice(0, 20);
    return (await selectSession(sessions)).file;
  }
  if (options.latest) {
    return findLatestSession(source);
  }
  return resolveBoundSessionFile();
}
