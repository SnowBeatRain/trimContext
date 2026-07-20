import { Command } from "commander";
import { registerDefaultCommand } from "./default.js";
import { registerCurrentCommand } from "./current.js";
import { registerAnalyzeCommand } from "./analyze.js";
import { registerReportCommand } from "./report.js";
import { registerCompressCommand } from "./compress.js";
import { registerNewChatCommands } from "./new-chat.js";
import { registerInitCommand } from "./init.js";
import { registerHookCommands } from "./hook.js";

export interface RegisterCommandsOptions {
  packageRoot: string;
  packageVersion: string;
}

export function registerCommands(program: Command, options: RegisterCommandsOptions): void {
  registerDefaultCommand(program);
  registerInitCommand(program, { packageRoot: options.packageRoot });
  registerCurrentCommand(program);
  registerAnalyzeCommand(program);
  registerReportCommand(program);
  registerCompressCommand(program);
  registerNewChatCommands(program, { packageVersion: options.packageVersion });
  registerHookCommands(program);
}
