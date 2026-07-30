import type { Command } from "commander";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatHandoff, formatHandoffReadme, formatNextContext } from "../core/handoff.js";
import { analyzeInput } from "../core/pipeline.js";
import {
  assertDifferentFiles,
  pathExists,
  writeFilesDistinctFromInput
} from "../platform/files.js";
import { resolveCurrentSessionFile } from "../sessions/discovery.js";
import { resolveInputFile } from "./shared.js";

export interface RegisterNewChatOptions {
  packageVersion: string;
}

export function registerNewChatCommand(program: Command, options: RegisterNewChatOptions): void {
  program
    .command("new-chat")
    .argument("[file]")
    .option("--out <directory>", "Write a uid-based package under this directory.")
    .description("Create a continuation package for a long conversation.")
    .action(async (file: string | undefined, commandOptions: { out?: string }) => {
      const inputFile = file ? resolveInputFile(file) : await resolveCurrentSessionFile("auto");
      await writeHandoffPackage(inputFile, commandOptions.out, options.packageVersion);
    });
}

async function writeHandoffPackage(
  file: string,
  outDir: string | undefined,
  packageVersion: string
): Promise<void> {
  const uid = generateHandoffUid();
  const rootDir = resolve(outDir ?? join(".trimctx", "handoffs"));
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
    const report = analyzeInput(input.toString("utf8"), file, {});
    const inputHash = createHash("sha256").update(input).digest("hex");
    const manifest = {
      schema_version: "trimctx.handoff_manifest.v1",
      health_status: report.assessment.status,
      health_confidence: report.assessment.confidence,
      report_schema_version: report.schema_version,
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
