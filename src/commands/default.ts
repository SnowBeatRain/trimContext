import type { Command } from "commander";
import { formatUserSummary } from "../cli/format-summary.js";
import { analyzeFile } from "../core/pipeline.js";
import {
  listSessions
} from "../sessions/catalog.js";
import { hasCurrentSessionBinding, resolveBoundSessionFile } from "../sessions/binding.js";
import { isInteractiveTerminal, selectSession } from "../sessions/picker.js";

export function registerDefaultCommand(program: Command): void {
  program
    .option("--color", "Colorize output for terminal.")
    .action(async (options: { color?: boolean }) => {
      const file = await resolveDefaultInput();
      const report = await analyzeFile(file, {});
      process.stdout.write(formatUserSummary(report, { color: options.color }));
    });
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
