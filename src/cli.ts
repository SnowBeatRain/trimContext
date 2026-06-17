#!/usr/bin/env node
import { Command } from "commander";
import { constants as fsConstants, readFileSync } from "node:fs";
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { analyzeMessages, parseJsonl } from "./core/analyzer.js";
import { compressFile } from "./core/compressor.js";
import { createReport } from "./core/reporter.js";
import { formatHandoff, formatNextContext } from "./core/handoff.js";
import { formatAnalysisSummary } from "./cli/format-summary.js";
import type { AnalysisOptions } from "./core/options.js";

const program = new Command();
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_VERSION = readPackageVersion();

program
  .name("trimctx")
  .description("Analyze and safely trim long AI conversation context.")
  .version(PACKAGE_VERSION);

program
  .command("init")
  .option("--client <client>", "Client assets to install: claude, codex, or all.", "all")
  .option("--target <target>", "Install target: user or project. Prompts when omitted.")
  .option("--dir <directory>", "Project directory for --target project, or base home directory for --target user.")
  .option("--force", "Overwrite existing installed trimctx assets.")
  .option("--dry-run", "Print planned installation paths without writing files.")
  .description("Install AI-client command files and skills for Claude Code and Codex.")
  .action(async (options: InitOptions) => {
    const result = await initClientAssets(options);
    for (const line of result.lines) {
      process.stdout.write(`${line}\n`);
    }
  });

program
  .command("resume")
  .option("--json", "Print the full JSON analysis report.")
  .option("--color", "Colorize output for terminal.")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .option("--compress <output.jsonl>", "Compress the latest session to a file.")
  .description("Analyze the most recent Claude Code session.")
  .action(async (options: CliAnalysisOptions & { json?: boolean; color?: boolean; compress?: string }) => {
    const file = await findLatestSession("claude");
    const analysisOptions = parseAnalysisOptions(options);
    if (options.compress) {
      const result = await compressFile(file, options.compress, analysisOptions);
      process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
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
      const result = await compressFile(file, options.compress, analysisOptions);
      process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
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
  .argument("<file>")
  .option("--json", "Print the full JSON analysis report.")
  .option("--color", "Colorize output for terminal.")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .description("Analyze a Claude Code, OpenAI, or Codex/Hermes JSONL conversation.")
  .action(async (file: string, options: CliAnalysisOptions & { json?: boolean; color?: boolean }) => {
    const report = await analyzeFile(file, parseAnalysisOptions(options));
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
    const result = await compressFile(file, options.output, parseAnalysisOptions(options));
    process.stdout.write(`${JSON.stringify(result.report.summary, null, 2)}\n`);
  });

program
  .command("handoff")
  .argument("<file>")
  .requiredOption("-o, --output <handoff.md>")
  .option("--next-context <next-context.md>", "Also write a compact next-context markdown file.")
  .option("--recent-window <count>", "Number of most recent messages to hard-protect.")
  .option("--remove-threshold <score>", "Rot score threshold for remove candidates.")
  .option("--compress-threshold <score>", "Rot score threshold for compression candidates.")
  .description("Write markdown handoff artifacts for continuing a long conversation safely.")
  .action(async (file: string, options: CliAnalysisOptions & { output: string; nextContext?: string }) => {
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
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trimctx: ${message}\n`);
  process.exitCode = 1;
});

type SessionSource = "auto" | "claude" | "codex";
type InitClient = "all" | "claude" | "codex";
type InitTarget = "user" | "project";

interface InitOptions {
  client?: string;
  target?: string;
  dir?: string;
  force?: boolean;
  dryRun?: boolean;
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

async function initClientAssets(options: InitOptions): Promise<InitResult> {
  const client = parseInitClient(options.client);
  const target = await resolveInitTarget(options.target);
  const baseDir = resolve(options.dir ?? (target === "user" ? homedir() : process.cwd()));
  const assets = initAssetsFor(client, target, baseDir);
  const lines = [`trimctx init: ${options.dryRun ? "planned" : "installed"} ${client} assets for ${target}`];

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

  lines.push("Restart the AI client, then run /trimctx in Claude Code or use the trimctx Codex skill.");
  return { lines };
}

function initAssetsFor(client: InitClient, target: InitTarget, baseDir: string): InitAsset[] {
  const assets: InitAsset[] = [];
  if (client === "all" || client === "claude") {
    assets.push({
      client: "claude",
      source: join(PACKAGE_ROOT, "plugins", "trimctx"),
      destination: target === "user"
        ? join(baseDir, ".claude", "plugins", "trimctx")
        : join(baseDir, ".claude", "plugins", "trimctx"),
      label: "Claude Code plugin commands"
    });
  }
  if (client === "all" || client === "codex") {
    assets.push({
      client: "codex",
      source: join(PACKAGE_ROOT, "codex", "skills", "trimctx"),
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

async function resolveInitTarget(value: string | undefined): Promise<InitTarget> {
  if (value !== undefined) {
    return parseInitTarget(value);
  }
  if (!isInteractiveInput()) {
    throw new Error("target is required in non-interactive mode; pass --target user or --target project");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await readline.question([
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
    readline.close();
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

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
    const packageJson = JSON.parse(raw) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Fall through to a visible fallback so --version still works in unusual dev layouts.
  }
  return "0.0.0-dev";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findLatestSession(source: SessionSource): Promise<string> {
  const roots = sessionRoots(source);
  let latestFile = "";
  let latestMtime = 0;

  for (const root of roots) {
    const candidate = await findLatestJsonlUnder(root);
    if (candidate && candidate.mtimeMs > latestMtime) {
      latestFile = candidate.file;
      latestMtime = candidate.mtimeMs;
    }
  }

  if (!latestFile) {
    throw new Error(`no ${source} session files found under ${roots.map(prettyHomePath).join(" or ")}`);
  }
  return latestFile;
}

function sessionRoots(source: SessionSource): string[] {
  const roots: Record<SessionSource, string[]> = {
    auto: [join(homedir(), ".claude", "projects"), join(homedir(), ".codex", "sessions")],
    claude: [join(homedir(), ".claude", "projects")],
    codex: [join(homedir(), ".codex", "sessions")]
  };
  return roots[source];
}

async function findLatestJsonlUnder(root: string): Promise<{ file: string; mtimeMs: number } | undefined> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let latest: { file: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findLatestJsonlUnder(fullPath);
      if (nested && (!latest || nested.mtimeMs > latest.mtimeMs)) {
        latest = nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const fileStat = await stat(fullPath);
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { file: fullPath, mtimeMs: fileStat.mtimeMs };
    }
  }
  return latest;
}

function parseSessionSource(value: string | undefined): SessionSource {
  if (value === undefined || value === "auto" || value === "claude" || value === "codex") {
    return value ?? "auto";
  }
  throw new Error("source must be one of: auto, claude, codex");
}

function prettyHomePath(file: string): string {
  const home = homedir();
  if (file === home) return "~";
  if (file.startsWith(`${home}/`)) return `~/${file.slice(home.length + 1)}`;
  return file;
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

async function analyzeFile(file: string, options: AnalysisOptions = {}) {
  const input = await readFile(file, "utf8");
  return createReport(analyzeMessages(parseJsonl(input, file), options), file);
}

async function assertDifferentFiles(leftFile: string, rightFile: string, message: string): Promise<void> {
  if (await sameFile(leftFile, rightFile)) {
    throw new Error(message);
  }
}

async function sameFile(leftFile: string, rightFile: string): Promise<boolean> {
  if (resolve(leftFile) === resolve(rightFile)) {
    return true;
  }
  try {
    const [leftStat, rightStat] = await Promise.all([stat(leftFile), stat(rightFile)]);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}
