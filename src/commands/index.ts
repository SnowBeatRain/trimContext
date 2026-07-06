import { Command } from "commander";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { compressFile } from "../core/compressor.js";
import { formatHandoff, formatHandoffReadme, formatNextContext } from "../core/handoff.js";
import { formatAnalysisSummary, formatUserSummary } from "../cli/format-summary.js";
import { runHook, writeSessionEnvBinding } from "../core/hook.js";
import {
  findLatestSession,
  parseSessionSource,
  prettyHomePath,
  analyzeFile,
  resolveCurrentSessionFile
} from "../core/session.js";
import { assertDifferentFiles } from "../platform/files.js";
import type { AnalysisOptions } from "../core/options.js";
import type { SessionSource } from "../core/session.js";

export interface RegisterCommandsOptions {
  packageRoot: string;
  packageVersion: string;
}

let packageRoot = "";
let packageVersion = "0.0.0-dev";

export function registerCommands(program: Command, options: RegisterCommandsOptions): void {
  packageRoot = options.packageRoot;
  packageVersion = options.packageVersion;

  program
    .option("--color", "Colorize output for terminal.")
    .action(async (options: { color?: boolean }) => {
      const file = await resolveCurrentSessionFile("auto");
      const report = await analyzeFile(file, {});
      process.stdout.write(formatUserSummary(report, { color: options.color }));
    });

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
      const result = await initClientAssets(options);
      for (const line of result.lines) {
        process.stdout.write(`${line}\n`);
      }
    });

  program
    .command("current")
    .option("--source <source>", "Session source to scan: auto, claude, or codex.", "auto")
    .option("--json", "Print the full JSON analysis report.")
    .option("--color", "Colorize output for terminal.")
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .option("--compress <output.jsonl>", "Compress the latest matching session to a file.")
    .description("Analyze the most recent Claude Code or Codex JSONL session.")
    .action(async (options: CliAnalysisOptions & { source?: string; json?: boolean; color?: boolean; compress?: string }) => {
      const source = parseSessionSource(options.source);
      const file = await findLatestSession(source);
      const analysisOptions = parseAnalysisOptions(options);
      if (options.compress) {
        await writeCompressionResult(file, options.compress, analysisOptions);
        return;
      }
      const report = await analyzeFile(file, analysisOptions);
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
    .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
    .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
    .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
    .description("Analyze a Claude Code, OpenAI, or Codex/Hermes JSONL conversation.")
    .action(async (file: string | undefined, options: CliAnalysisOptions & { json?: boolean; color?: boolean }) => {
      const inputFile = resolveInputFile(file);
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
      const report = await analyzeFile(file, parseAnalysisOptions(options));
      await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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

  function configureNewChatCommand(command: Command, description: string): void {
    command
      .argument("[file]")
      .option("-o, --output <handoff.md>", "Write a legacy single handoff markdown file.")
      .option("--next-context <next-context.md>", "Also write a compact next-context markdown file with --output.")
      .option("--out, --out-dir <directory>", "Write a uid-based new-chat package under this directory.")
      .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
      .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
      .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
      .description(description)
      .action(async (file: string | undefined, options: CliAnalysisOptions & { output?: string; nextContext?: string; outDir?: string }) => {
        const inputFile = file ? resolveInputFile(file) : await resolveCurrentSessionFile("auto");
        if (options.outDir && (options.output || options.nextContext)) {
          throw new Error("--out cannot be combined with -o/--output or --next-context");
        }
        if (options.output) {
          await writeLegacyHandoff(inputFile, { ...options, output: options.output });
          return;
        }
        if (options.nextContext) {
          throw new Error("--next-context requires -o/--output; omit both to create a new-chat package");
        }
        await writeHandoffPackage(inputFile, options);
      });
  }

  configureNewChatCommand(
    program.command("new-chat"),
    "Create a new-chat continuation package for a long conversation."
  );

  configureNewChatCommand(
    program.command("handoff"),
    "Compatibility alias for new-chat: write markdown handoff artifacts for continuing safely."
  );

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

interface InitResult {
  lines: string[];
}

class PromptSession {
  private readonly readline = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  private readonly pendingResolvers: Array<(line: string) => void> = [];
  private readonly lines: string[] = [];
  private ended = false;

  constructor() {
    this.readline.on("line", line => {
      const resolveNext = this.pendingResolvers.shift();
      if (resolveNext) {
        resolveNext(line);
      } else {
        this.lines.push(line);
      }
    });
    this.readline.on("close", () => {
      this.ended = true;
      while (this.pendingResolvers.length > 0) {
        this.pendingResolvers.shift()?.("");
      }
    });
  }

  async question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const line = this.lines.shift();
    if (line !== undefined || this.ended) {
      return line ?? "";
    }
    return await new Promise(resolve => this.pendingResolvers.push(resolve));
  }

  close(): void {
    this.readline.close();
  }
}

async function initClientAssets(options: InitOptions): Promise<InitResult> {
  const client = parseInitClient(options.client);
  const readline = options.target === undefined && isInteractiveInput()
    ? new PromptSession()
    : undefined;
  try {
    const target = await resolveInitTarget(options.target, readline);
    const baseDir = resolve(options.dir ?? (target === "user" ? homedir() : process.cwd()));
    const assets = initAssetsFor(client, target, baseDir);
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
      lines.push(...hookLines.map(l => `- ${l}`));
    } else if (client === "all" || client === "claude") {
      lines.push("- hooks not installed; run `trimctx install-hooks` or `trimctx init --with-hooks` to enable Claude current-window binding later.");
    }

    if (!options.dryRun) {
      lines.push(...initNextStepLines());
    }
    return { lines };
  } finally {
    readline?.close();
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

function initAssetsFor(client: InitClient, target: InitTarget, baseDir: string): InitAsset[] {
  const assets: InitAsset[] = [];
  if (client === "all" || client === "claude") {
    assets.push({
      client: "claude",
      source: join(packageRoot, "plugins", "trimctx"),
      destination: target === "user"
        ? join(baseDir, ".claude", "plugins", "trimctx")
        : join(baseDir, ".claude", "plugins", "trimctx"),
      label: "Claude Code plugin commands"
    });
  }
  if (client === "all" || client === "codex") {
    assets.push({
      client: "codex",
      source: join(packageRoot, "codex", "skills", "trimctx"),
      destination: target === "user"
        ? join(baseDir, ".codex", "skills", "trimctx")
        : join(baseDir, ".codex", "skills", "trimctx"),
      label: "Codex skill"
    });
  }
  return assets;
}

function parseInitClient(value: string | undefined): InitClient {
  if (value === undefined || value === "all" || value === "claude" || value === "codex") {
    return value ?? "all";
  }
  throw new Error("client must be one of: all, claude, codex");
}

function parseInitTarget(value: string | undefined): InitTarget {
  if (value === "user" || value === "project") {
    return value;
  }
  throw new Error("target must be one of: user, project");
}

async function resolveInitTarget(value: string | undefined, readline?: PromptSession): Promise<InitTarget> {
  if (value !== undefined) {
    return parseInitTarget(value);
  }
  if (!isInteractiveInput()) {
    throw new Error("target is required in non-interactive mode; pass --target user or --target project");
  }

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
      if (answer === "" || answer === "1" || answer === "user" || answer === "global") {
        return "user";
      }
      if (answer === "2" || answer === "project" || answer === "local") {
        return "project";
      }
      process.stdout.write("Please choose 1 for user/global or 2 for project.\n");
    }
  } finally {
    if (ownsReadline) {
      prompt.close();
    }
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeLegacyHandoff(
  file: string,
  options: CliAnalysisOptions & { output: string; nextContext?: string }
): Promise<void> {
  await assertDifferentFiles(file, options.output, "Output file must be different from input file");
  if (options.nextContext) {
    await assertDifferentFiles(file, options.nextContext, "Next context file must be different from input file");
    await assertDifferentFiles(options.output, options.nextContext, "Next context file must be different from handoff output file");
  }
  const report = await analyzeFile(file, parseAnalysisOptions(options));
  await writeFile(options.output, formatHandoff(report), "utf8");
  if (options.nextContext) {
    await writeFile(options.nextContext, formatNextContext(report), "utf8");
  }
  process.stdout.write(`handoff: ${options.output}\n`);
  if (options.nextContext) {
    process.stdout.write(`next-context: ${options.nextContext}\n`);
  }
}

async function writeHandoffPackage(
  file: string,
  options: CliAnalysisOptions & { outDir?: string }
): Promise<void> {
  const uid = generateHandoffUid();
  const rootDir = resolve(options.outDir ?? join(".trimctx", "handoffs"));
  const packageDir = join(rootDir, uid);
  const handoffPath = join(packageDir, "handoff.md");
  const nextContextPath = join(packageDir, "next-context.md");
  const manifestPath = join(packageDir, "manifest.json");
  const reportPath = join(packageDir, "report.json");
  const readmePath = join(packageDir, "README.md");

  await assertDifferentFiles(file, handoffPath, "Handoff package must be different from input file");
  await assertDifferentFiles(file, nextContextPath, "Handoff package must be different from input file");
  await assertDifferentFiles(file, manifestPath, "Handoff package must be different from input file");
  await assertDifferentFiles(file, reportPath, "Handoff package must be different from input file");
  await assertDifferentFiles(file, readmePath, "Handoff package must be different from input file");
  if (await pathExists(packageDir)) {
    throw new Error(`handoff package already exists: ${packageDir}`);
  }

  const report = await analyzeFile(file, parseAnalysisOptions(options));
  const inputHash = createHash("sha256").update(await readFile(file)).digest("hex");
  const manifest = {
    schema_version: "trimctx.handoff_manifest.v1",
    uid,
    created_at: new Date().toISOString(),
    trimctx_version: packageVersion,
    input: {
      file,
      sha256: inputHash,
      source: report.input.source,
      session_id: report.input.session_id
    },
    files: {
      handoff: handoffPath,
      next_context: nextContextPath,
      manifest: manifestPath,
      report: reportPath,
      readme: readmePath
    },
    files_relative: {
      handoff: "handoff.md",
      next_context: "next-context.md",
      manifest: "manifest.json",
      report: "report.json",
      readme: "README.md"
    },
    warnings: [
      "This package may contain original transcript content and secrets; review before sharing."
    ],
    summary: {
      total_messages: report.summary.total_messages,
      remove_candidates: report.summary.remove_candidates,
      compress_candidates: report.summary.compress_candidates,
      protected_messages: report.summary.protected_messages,
      context_pressure: report.summary.context_pressure
    }
  };

  await mkdir(packageDir, { recursive: true });
  await writeFile(handoffPath, formatHandoff(report), "utf8");
  await writeFile(nextContextPath, formatNextContext(report), "utf8");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(readmePath, formatHandoffReadme(report), "utf8");

  process.stdout.write(`copyable uid: ${uid}\n`);
  process.stdout.write(`uid: ${uid}\n`);
  process.stdout.write(`source: ${file}\n`);
  process.stdout.write(`handoff: ${handoffPath}\n`);
  process.stdout.write(`next-context: ${nextContextPath}\n`);
  process.stdout.write(`manifest: ${manifestPath}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  process.stdout.write(`readme: ${readmePath}\n`);
}

function generateHandoffUid(): string {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "_",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0")
  ].join("");
  return `ctx_${timestamp}_${randomBytes(3).toString("hex")}`;
}



interface CliAnalysisOptions {
  recentWindow?: string;
  removeThreshold?: string;
  compressThreshold?: string;
}

function parseAnalysisOptions(options: CliAnalysisOptions): AnalysisOptions {
  return {
    recentWindow: parseOptionalInteger(options.recentWindow, "recent-window"),
    removeThreshold: parseOptionalNumber(options.removeThreshold, "remove-threshold"),
    compressThreshold: parseOptionalNumber(options.compressThreshold, "compress-threshold")
  };
}

function parseOptionalInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  if (parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a number`);
  }
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be between 0 and 1`);
  }
  return parsed;
}

async function resolveInitHooks(options: InitOptions, client: InitClient, readline?: PromptSession): Promise<boolean> {
  if (client === "codex") {
    return false;
  }
  if (options.hooks === false) {
    return false;
  }
  if (options.withHooks) {
    return true;
  }
  if (options.target !== undefined || !isInteractiveInput()) {
    return false;
  }

  const ownsReadline = readline === undefined;
  const prompt = readline ?? new PromptSession();
  try {
    for (;;) {
      const answer = (await prompt.question([
        "Enable Claude current-window hooks?",
        "  This lets /trimctx and /trimctx:handoff bind to the active Claude Code transcript.",
        "Choose Y or n [Y]: "
      ].join("\n"))).trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        return true;
      }
      if (answer === "n" || answer === "no") {
        return false;
      }
      process.stdout.write("Please choose Y to enable hooks or n to skip.\n");
    }
  } finally {
    if (ownsReadline) {
      prompt.close();
    }
  }
}


function resolveInputFile(file: string | undefined): string {
  const inputFile = file ?? process.env.TRIMCTX_TRANSCRIPT_PATH;
  if (!inputFile) {
    throw new Error("file argument is required unless TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session");
  }
  return inputFile;
}

async function writeCompressionResult(inputFile: string, outputFile: string, options: AnalysisOptions): Promise<void> {
  await assertDifferentFiles(inputFile, outputFile, "Output file must be different from input file");
  const result = await compressFile(inputFile, outputFile, options);
  process.stdout.write(`${JSON.stringify({ output: outputFile, summary: result.report.summary }, null, 2)}\n`);
}

async function installHooks(
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
