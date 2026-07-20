import type { Command } from "commander";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatHandoff, formatHandoffReadme, formatNextContext } from "../core/handoff.js";
import { analyzeInput } from "../core/pipeline.js";
import {
  assertDifferentFiles,
  pathExists,
  writeFileDistinctFromInput,
  writeFilesDistinctFromInput
} from "../platform/files.js";
import { resolveCurrentSessionFile } from "../sessions/discovery.js";
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

function configureNewChatCommand(
  command: Command,
  description: string,
  registerOptions: RegisterNewChatOptions
): void {
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

  const inputHandle = await open(file, "r");
  try {
    const report = analyzeInput(
      await inputHandle.readFile("utf8"),
      file,
      parseAnalysisOptions(options)
    );
    if (!options.nextContext) {
      await writeFileDistinctFromInput(
        inputHandle,
        options.output,
        formatHandoff(report),
        "Output file must be different from input file"
      );
    } else {
      await writeFilesDistinctFromInput(inputHandle, [
        {
          file: options.output,
          data: formatHandoff(report),
          inputConflictMessage: "Output file must be different from input file"
        },
        {
          file: options.nextContext,
          data: formatNextContext(report),
          inputConflictMessage: "Next context file must be different from input file",
          outputConflictMessage: "Next context file must be different from handoff output file"
        }
      ]);
    }
  } finally {
    await inputHandle.close();
  }
  process.stdout.write(`handoff: ${options.output}\n`);
  if (options.nextContext) process.stdout.write(`next-context: ${options.nextContext}\n`);
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

  for (const outputPath of [handoffPath, nextContextPath, manifestPath, reportPath, readmePath]) {
    await assertDifferentFiles(file, outputPath, "Handoff package must be different from input file");
  }
  if (await pathExists(packageDir)) {
    throw new Error(`handoff package already exists: ${packageDir}`);
  }

  const inputHandle = await open(file, "r");
  try {
    const input = await inputHandle.readFile();
    const report = analyzeInput(input.toString("utf8"), file, parseAnalysisOptions(options));
    const inputHash = createHash("sha256").update(input).digest("hex");
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
      warnings: ["This package may contain original transcript content and secrets; review before sharing."],
      summary: {
        total_messages: report.summary.total_messages,
        remove_candidates: report.summary.remove_candidates,
        compress_candidates: report.summary.compress_candidates,
        protected_messages: report.summary.protected_messages,
        context_pressure: report.summary.context_pressure
      }
    };

    await mkdir(packageDir, { recursive: true });
    const conflictMessage = "Handoff package must be different from input file";
    await writeFilesDistinctFromInput(inputHandle, [
      { file: handoffPath, data: formatHandoff(report), inputConflictMessage: conflictMessage },
      { file: nextContextPath, data: formatNextContext(report), inputConflictMessage: conflictMessage },
      { file: reportPath, data: `${JSON.stringify(report, null, 2)}\n`, inputConflictMessage: conflictMessage },
      { file: manifestPath, data: `${JSON.stringify(manifest, null, 2)}\n`, inputConflictMessage: conflictMessage },
      { file: readmePath, data: formatHandoffReadme(report), inputConflictMessage: conflictMessage }
    ]);

    process.stdout.write(`copyable uid: ${uid}\n`);
    process.stdout.write(`uid: ${uid}\n`);
    process.stdout.write(`source: ${file}\n`);
    process.stdout.write(`handoff: ${handoffPath}\n`);
    process.stdout.write(`next-context: ${nextContextPath}\n`);
    process.stdout.write(`manifest: ${manifestPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
    process.stdout.write(`readme: ${readmePath}\n`);
  } finally {
    await inputHandle.close();
  }
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
