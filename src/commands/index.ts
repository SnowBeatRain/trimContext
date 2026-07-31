import { Command } from "commander";
import { registerDefaultCommand } from "./default.js";
import { registerAnalyzeCommand } from "./analyze.js";
import { registerReportCommand } from "./report.js";
import { registerExportCommand } from "./export.js";
import { registerCompressCommand } from "./compress.js";
import { registerNewChatCommand } from "./new-chat.js";
import { registerInitCommand } from "./init.js";
import { createHookCommand } from "./hook.js";

export interface RegisterCommandsOptions {
  packageRoot: string;
  packageVersion: string;
}

export function registerCommands(program: Command, options: RegisterCommandsOptions): void {
  registerDefaultCommand(program);
  registerInitCommand(program, { packageRoot: options.packageRoot });
  registerAnalyzeCommand(program);
  registerReportCommand(program);
  registerExportCommand(program);
  registerCompressCommand(program);
  registerNewChatCommand(program, { packageVersion: options.packageVersion });
  program.addCommand(createHookCommand(), { hidden: true });
}
