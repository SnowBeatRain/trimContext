import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runHook, writeSessionEnvBinding } from "../core/hook.js";

type InitTarget = "user" | "project";

export function registerHookCommands(program: Command): void {
  program
    .command("hook")
    .option("--dry-run", "Print analysis result without modifying CLAUDE.md.")
    .option("--session-start", "Run as a Claude Code SessionStart hook and persist current transcript binding.")
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

  program
    .command("install-hooks")
    .option("--target <target>", "Install target: user or project.", "user")
    .option("--dir <directory>", "Override the base directory.")
    .option("--force", "Overwrite existing trimctx hook configuration.")
    .option("--dry-run", "Print planned configuration without writing.")
    .description("Install experimental Claude Code hooks into settings.json.")
    .action(async (options: { target?: string; dir?: string; force?: boolean; dryRun?: boolean }) => {
      const target = parseInitTarget(options.target);
      const baseDir = options.dir ? resolve(options.dir) : (target === "user" ? homedir() : process.cwd());
      const settingsPath = join(baseDir, ".claude", "settings.json");
      const lines = await installHooks(settingsPath, { force: options.force, dryRun: options.dryRun });
      for (const line of lines) {
        process.stdout.write(`${line}\n`);
      }
    });
}

function parseInitTarget(value: string | undefined): InitTarget {
  if (value === "user" || value === "project") {
    return value;
  }
  throw new Error("target must be one of: user, project");
}

export async function installHooks(
  settingsPath: string,
  options: { force?: boolean; dryRun?: boolean } = {}
): Promise<string[]> {
  const TRIMCTX_HOOK_COMMAND = "trimctx hook";
  const TRIMCTX_SESSION_ENV_COMMAND = "trimctx hook --session-start";
  let settings: Record<string, unknown> = {};

  try {
    const raw = await readFile(settingsPath, "utf8");
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // 文件不存在，从空对象开始
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const sessionStartHooks = (hooks.SessionStart ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
  const stopHooks = (hooks.Stop ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;

  const hasSessionEnvHook = sessionStartHooks.some(group =>
    (group.hooks ?? []).some(h => h.type === "command" && h.command === TRIMCTX_SESSION_ENV_COMMAND)
  );
  const hasTrimctxHook = stopHooks.some(group =>
    (group.hooks ?? []).some(h => h.type === "command" && h.command === TRIMCTX_HOOK_COMMAND)
  );

  if (hasSessionEnvHook && hasTrimctxHook && !options.force) {
    return [`experimental Claude hooks already installed in ${settingsPath}`];
  }

  const newSessionStartHooks = options.force
    ? sessionStartHooks.filter(group =>
        !(group.hooks ?? []).some(h => h.type === "command" && h.command === TRIMCTX_SESSION_ENV_COMMAND)
      )
    : [...sessionStartHooks];
  const newStopHooks = options.force
    ? stopHooks.filter(group =>
        !(group.hooks ?? []).some(h => h.type === "command" && h.command === TRIMCTX_HOOK_COMMAND)
      )
    : [...stopHooks];

  if (!hasSessionEnvHook || options.force) {
    newSessionStartHooks.push({
      hooks: [{ type: "command", command: TRIMCTX_SESSION_ENV_COMMAND }]
    });
  }
  if (!hasTrimctxHook || options.force) {
    newStopHooks.push({
      hooks: [{ type: "command", command: TRIMCTX_HOOK_COMMAND }]
    });
  }

  const newSettings = { ...settings, hooks: { ...hooks, SessionStart: newSessionStartHooks, Stop: newStopHooks } };
  const output = `${JSON.stringify(newSettings, null, 2)}\n`;

  if (options.dryRun) {
    return [
      `dry-run: would write experimental Claude hooks to ${settingsPath}`,
      output.trimEnd()
    ];
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, output, "utf8");
  return [`installed experimental Claude hooks in ${settingsPath}`];
}
