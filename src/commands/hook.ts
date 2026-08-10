import { Command, Option } from "commander";
import { runHook, writeSessionEnvBinding } from "../core/hook.js";
import { TRIMCTX_MANAGED_HOOK_FLAG } from "./hook-settings.js";

export function createHookCommand(): Command {
  return new Command("hook")
    .option("--dry-run", "Print analysis result without modifying CLAUDE.md.")
    .option("--session-start", "Run as a Claude Code SessionStart hook and persist current transcript binding.")
    .addOption(new Option(TRIMCTX_MANAGED_HOOK_FLAG).hideHelp())
    .description("Run as a Claude Code Stop hook: analyze session and update CLAUDE.md context state.")
    .action(async (options: { dryRun?: boolean; sessionStart?: boolean }) => {
      if (options.sessionStart) {
        const result = await writeSessionEnvBinding();
        process.stdout.write(`${result.message}\n`);
        return;
      }
      const result = await runHook({ dryRun: options.dryRun });
      process.stdout.write(`${result.message}\n`);
    });
}
