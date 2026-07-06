import type { Command } from "commander";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { formatHandoff, formatHandoffReadme, formatNextContext } from "../core/handoff.js";
import { analyzeFile, resolveCurrentSessionFile } from "../core/session.js";
import { assertDifferentFiles } from "../platform/files.js";
import { parseAnalysisOptions, resolveInputFile, type CliAnalysisOptions } from "./shared.js";

export interface RegisterNewChatOptions {
  packageVersion: string;
}

export function registerNewChatCommands(program: Command, options: RegisterNewChatOptions): void {
  configureNewChatCommand(
    program.command("new-chat"),
    "Create a new-chat continuation package for a long conversation.",
    options
  );

  configureNewChatCommand(
    program.command("handoff"),
    "Compatibility alias for new-chat: write markdown handoff artifacts for continuing safely.",
    options
  );
}

function configureNewChatCommand(command: Command, description: string, registerOptions: RegisterNewChatOptions): void {
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
      await writeHandoffPackage(inputFile, options, registerOptions.packageVersion);
    });
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
  options: CliAnalysisOptions & { outDir?: string },
  packageVersion: string
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
