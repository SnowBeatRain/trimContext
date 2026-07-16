import type { Command } from "commander";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { runHook, writeSessionEnvBinding } from "../core/hook.js";
import { pathExists } from "../platform/files.js";

export function registerInitCommand(program: Command, packageRoot: string): void {
  program
    .command("init")
    .option("--client <client>", "Client assets to install: claude, codex, or all.", "all")
    .option("--target <target>", "Install target: user or project. Prompts when omitted.")
    .option("--dir <directory>", "Project directory for --target project, or base home directory for --target user.")
    .option("--force", "Overwrite existing installed trimctx assets.")
    .option("--dry-run", "Print planned installation paths without writing files.")
    .option("--with-hooks", "Also install experimental Claude Code current-window hooks.")
    .option("--no-hooks", "Do not install Claude Code hooks.")
    .description("Install AI-client command files and skills for Claude Code and Codex.")
    .action(async (options: InitOptions) => {
      const result = await initClientAssets(options, packageRoot);
      for (const line of result.lines) process.stdout.write(`${line}\n`);
    });
}

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
      for (const line of lines) process.stdout.write(`${line}\n`);
    });
}

type InitClient = "all" | "claude" | "codex";
type InitTarget = "user" | "project";

interface InitOptions {
  client?: string;
  target?: string;
  dir?: string;
  force?: boolean;
  dryRun?: boolean;
  withHooks?: boolean;
  hooks?: boolean;
}

interface InitAsset {
  client: "claude" | "codex";
  source: string;
  destination: string;
  label: string;
}

class PromptSession {
  private readonly readline = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  private readonly pendingResolvers: Array<(line: string) => void> = [];
  private readonly lines: string[] = [];
  private ended = false;

  constructor() {
    this.readline.on("line", line => {
      const resolveNext = this.pendingResolvers.shift();
      if (resolveNext) resolveNext(line);
      else this.lines.push(line);
    });
    this.readline.on("close", () => {
      this.ended = true;
      while (this.pendingResolvers.length > 0) this.pendingResolvers.shift()?.("");
    });
  }

  async question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const line = this.lines.shift();
    if (line !== undefined || this.ended) return line ?? "";
    return await new Promise(resolveQuestion => this.pendingResolvers.push(resolveQuestion));
  }

  close(): void {
    this.readline.close();
  }
}

async function initClientAssets(options: InitOptions, packageRoot: string): Promise<{ lines: string[] }> {
  const client = parseInitClient(options.client);
  const readline = options.target === undefined && isInteractiveInput() ? new PromptSession() : undefined;
  try {
    const target = await resolveInitTarget(options.target, readline);
    const baseDir = resolve(options.dir ?? (target === "user" ? homedir() : process.cwd()));
    const assets = initAssetsFor(client, target, baseDir, packageRoot);
    const lines = [`trimctx init: ${options.dryRun ? "planned" : "installed"} ${client} assets for ${target}`];
    const shouldInstallHooks = await resolveInitHooks(options, client, readline);

    for (const asset of assets) {
      await assertTemplateExists(asset.source, asset.label);
      if (options.dryRun) {
        lines.push(`- ${asset.label}: ${asset.destination}`);
        continue;
      }
      if (await pathExists(asset.destination)) {
        if (!options.force) {
          throw new Error(`${asset.destination} already exists; rerun with --force to overwrite trimctx ${asset.client} assets`);
        }
        await replaceInstalledAsset(asset);
      } else {
        await mkdir(dirname(asset.destination), { recursive: true });
        await cp(asset.source, asset.destination, { recursive: true });
      }
      lines.push(`- ${asset.label}: ${asset.destination}`);
    }

    if (shouldInstallHooks) {
      const settingsPath = join(baseDir, ".claude", "settings.json");
      const hookLines = await installHooks(settingsPath, { force: options.force, dryRun: options.dryRun });
      lines.push(...hookLines.map(line => `- ${line}`));
    } else if (client === "all" || client === "claude") {
      lines.push("- hooks not installed; run `trimctx install-hooks` or `trimctx init --with-hooks` to enable Claude current-window binding later.");
    }
    if (!options.dryRun) lines.push(...initNextStepLines());
    return { lines };
  } finally {
    readline?.close();
  }
}

function initNextStepLines(): string[] {
  return [
    "", "安装好了。", "", "现在你可以这样用：", "", "Claude Code 当前窗口：", "  /trimctx", "",
    "终端里：", "  trimctx", "  trimctx new-chat", "", "如果 /trimctx 找不到当前会话，请重启 Claude Code。"
  ];
}

function initAssetsFor(client: InitClient, target: InitTarget, baseDir: string, packageRoot: string): InitAsset[] {
  const assets: InitAsset[] = [];
  if (client === "all" || client === "claude") {
    assets.push({
      client: "claude",
      source: join(packageRoot, "plugins", "trimctx"),
      destination: join(baseDir, ".claude", "plugins", "trimctx"),
      label: "Claude Code plugin commands"
    });
  }
  if (client === "all" || client === "codex") {
    assets.push({
      client: "codex",
      source: join(packageRoot, "codex", "skills", "trimctx"),
      destination: join(baseDir, ".codex", "skills", "trimctx"),
      label: "Codex skill"
    });
  }
  return assets;
}

function parseInitClient(value: string | undefined): InitClient {
  if (value === undefined || value === "all" || value === "claude" || value === "codex") return value ?? "all";
  throw new Error("client must be one of: all, claude, codex");
}

function parseInitTarget(value: string | undefined): InitTarget {
  if (value === "user" || value === "project") return value;
  throw new Error("target must be one of: user, project");
}

async function resolveInitTarget(value: string | undefined, readline?: PromptSession): Promise<InitTarget> {
  if (value !== undefined) return parseInitTarget(value);
  if (!isInteractiveInput()) throw new Error("target is required in non-interactive mode; pass --target user or --target project");
  const ownsReadline = readline === undefined;
  const prompt = readline ?? new PromptSession();
  try {
    for (;;) {
      const answer = (await prompt.question([
        "Where should trimctx install AI-client assets?",
        "  1) User/global: ~/.claude/plugins/trimctx and ~/.codex/skills/trimctx",
        "  2) Project: ./.claude/plugins/trimctx and ./.codex/skills/trimctx",
        "Choose 1 or 2 [1]: "
      ].join("\n"))).trim().toLowerCase();
      if (answer === "" || answer === "1" || answer === "user" || answer === "global") return "user";
      if (answer === "2" || answer === "project" || answer === "local") return "project";
      process.stdout.write("Please choose 1 for user/global or 2 for project.\n");
    }
  } finally {
    if (ownsReadline) prompt.close();
  }
}

function isInteractiveInput(): boolean {
  return process.env.TRIMCTX_FORCE_INTERACTIVE === "1" || Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function assertTemplateExists(path: string, label: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} template is missing from the installed package: ${path}`);
  }
}

async function replaceInstalledAsset(asset: InitAsset): Promise<void> {
  if (asset.destination === dirname(asset.destination) || asset.destination.endsWith("..")) {
    throw new Error(`refusing to overwrite unsafe ${asset.client} destination: ${asset.destination}`);
  }
  if (asset.destination.split(/[\\/]+/).at(-1) !== "trimctx") {
    throw new Error(`refusing to overwrite non-trimctx ${asset.client} destination: ${asset.destination}`);
  }
  await rm(asset.destination, { recursive: true, force: true });
  await mkdir(dirname(asset.destination), { recursive: true });
  await cp(asset.source, asset.destination, { recursive: true });
}

async function resolveInitHooks(options: InitOptions, client: InitClient, readline?: PromptSession): Promise<boolean> {
  if (client === "codex" || options.hooks === false) return false;
  if (options.withHooks) return true;
  if (options.target !== undefined || !isInteractiveInput()) return false;
  const ownsReadline = readline === undefined;
  const prompt = readline ?? new PromptSession();
  try {
    for (;;) {
      const answer = (await prompt.question([
        "Enable Claude current-window hooks?",
        "  This lets /trimctx and /trimctx:handoff bind to the active Claude Code transcript.",
        "Choose Y or n [Y]: "
      ].join("\n"))).trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      process.stdout.write("Please choose Y to enable hooks or n to skip.\n");
    }
  } finally {
    if (ownsReadline) prompt.close();
  }
}

async function installHooks(settingsPath: string, options: { force?: boolean; dryRun?: boolean } = {}): Promise<string[]> {
  const trimctxHookCommand = "trimctx hook";
  const sessionEnvCommand = "trimctx hook --session-start";
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
    // Missing settings start from an empty object.
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const sessionStartHooks = (hooks.SessionStart ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
  const stopHooks = (hooks.Stop ?? []) as Array<{ hooks?: Array<{ type?: string; command?: string }> }>;
  const hasSessionEnvHook = sessionStartHooks.some(group => (group.hooks ?? []).some(hook => hook.type === "command" && hook.command === sessionEnvCommand));
  const hasTrimctxHook = stopHooks.some(group => (group.hooks ?? []).some(hook => hook.type === "command" && hook.command === trimctxHookCommand));
  if (hasSessionEnvHook && hasTrimctxHook && !options.force) return [`experimental Claude hooks already installed in ${settingsPath}`];

  const newSessionStartHooks = options.force
    ? sessionStartHooks.filter(group => !(group.hooks ?? []).some(hook => hook.type === "command" && hook.command === sessionEnvCommand))
    : [...sessionStartHooks];
  const newStopHooks = options.force
    ? stopHooks.filter(group => !(group.hooks ?? []).some(hook => hook.type === "command" && hook.command === trimctxHookCommand))
    : [...stopHooks];
  if (!hasSessionEnvHook || options.force) newSessionStartHooks.push({ hooks: [{ type: "command", command: sessionEnvCommand }] });
  if (!hasTrimctxHook || options.force) newStopHooks.push({ hooks: [{ type: "command", command: trimctxHookCommand }] });

  const output = `${JSON.stringify({ ...settings, hooks: { ...hooks, SessionStart: newSessionStartHooks, Stop: newStopHooks } }, null, 2)}\n`;
  if (options.dryRun) return [`dry-run: would write experimental Claude hooks to ${settingsPath}`, output.trimEnd()];
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, output, "utf8");
  return [`installed experimental Claude hooks in ${settingsPath}`];
}
