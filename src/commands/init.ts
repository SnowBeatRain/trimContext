import { Command } from "commander";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { installHooks } from "./hook-installer.js";
import { installInitAssets } from "./init-installer.js";
import { createInitAssets, parseInitClient } from "./init-plan.js";
import { isInteractiveInput, PromptSession, resolveInitTarget } from "./init-prompt.js";

export interface RegisterInitCommandOptions {
  packageRoot: string;
}

interface InitOptions {
  client?: string;
  target?: string;
  dir?: string;
  force?: boolean;
  dryRun?: boolean;
  withHooks?: boolean;
}

interface InitResult {
  lines: string[];
}

export function registerInitCommand(program: Command, options: RegisterInitCommandOptions): void {
  program
    .command("init")
    .option("--client <client>", "Client assets to install: claude, codex, or all.", "all")
    .option("--target <target>", "Install target: user or project. Prompts when omitted.")
    .option("--dir <directory>", "Project directory for --target project, or base home directory for --target user.")
    .option("--force", "Overwrite existing installed trimctx assets.")
    .option("--dry-run", "Print planned installation paths without writing files.")
    .option("--with-hooks", "Also install experimental Claude Code current-window hooks.")
    .description("Install AI-client command files and skills for Claude Code and Codex.")
    .action(async (commandOptions: InitOptions) => {
      const result = await initClientAssets(commandOptions, options.packageRoot);
      for (const line of result.lines) {
        process.stdout.write(`${line}\n`);
      }
    });
}

async function initClientAssets(options: InitOptions, packageRoot: string): Promise<InitResult> {
  const client = parseInitClient(options.client);
  const prompt = options.target === undefined && isInteractiveInput()
    ? new PromptSession()
    : undefined;
  try {
    const target = await resolveInitTarget(options.target, prompt);
    const baseDir = resolve(options.dir ?? (target === "user" ? homedir() : process.cwd()));
    const assets = createInitAssets(packageRoot, client, baseDir);
    const lines = [`trimctx init: ${options.dryRun ? "planned" : "installed"} ${client} assets for ${target}`];
    const shouldInstallHooks = options.withHooks === true && client !== "codex";
    const settingsPath = shouldInstallHooks
      ? join(baseDir, ".claude", "settings.json")
      : undefined;
    const hookPreflightLines = settingsPath
      ? await installHooks(settingsPath, { force: options.force, dryRun: true })
      : undefined;

    lines.push(...await installInitAssets(assets, {
      force: options.force,
      dryRun: options.dryRun
    }));

    if (settingsPath && hookPreflightLines) {
      const hookLines = options.dryRun
        ? hookPreflightLines
        : await installHooks(settingsPath, { force: options.force });
      lines.push(...hookLines.map((line) => `- ${line}`));
    } else if (client === "all" || client === "claude") {
      lines.push("- hooks not installed; rerun `trimctx init --with-hooks --force` to enable Claude current-window binding later.");
    }

    if (!options.dryRun) {
      lines.push(...initNextStepLines());
    }
    return { lines };
  } finally {
    prompt?.close();
  }
}

function initNextStepLines(): string[] {
  return [
    "",
    "安装好了。",
    "",
    "现在你可以这样用：",
    "",
    "Claude Code 当前窗口：",
    "  /trimctx",
    "",
    "终端里：",
    "  trimctx",
    "  trimctx new-chat",
    "",
    "如果 /trimctx 找不到当前会话，请重启 Claude Code。"
  ];
}
