import type { Command } from "commander";
import { formatAnalysisSummary } from "../cli/format-summary.js";
import { analyzeFile } from "../core/pipeline.js";
import {
  findLatestSession,
  listSessions,
  parseSessionSource,
  resolveBoundSessionFile
} from "../sessions/discovery.js";
import { isInteractiveTerminal, selectSession } from "../sessions/picker.js";
import { parseAnalysisOptions, type CliAnalysisOptions } from "./shared.js";

interface AnalyzeSelectionOptions extends CliAnalysisOptions {
  json?: boolean;
  color?: boolean;
  select?: boolean;
  latest?: boolean;
  source?: string;
}

export function registerAnalyzeCommand(program: Command): void {
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
