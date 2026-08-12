import type { Command } from "commander";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatHandoff, formatHandoffReadme, formatNextContext } from "../core/handoff.js";
import { analyzeInput } from "../core/pipeline.js";
import {
  assertDifferentFiles,
  assertInputSnapshotUnchanged,
  writeFilesDistinctFromInput
} from "../platform/files.js";
import { resolveCurrentSessionFile } from "../sessions/binding.js";
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

  const inputHandle = await open(file, "r");
  try {
    const inputSnapshot = await inputHandle.stat();
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
    const conflictMessage = "Handoff package must be different from input file";
    const staging = await createOwnedStagingDirectory(rootDir, uid);
    try {
      const outputs = [
        { file: join(staging.path, "handoff.md"), data: formatHandoff(report), inputConflictMessage: conflictMessage },
        { file: join(staging.path, "next-context.md"), data: formatNextContext(report), inputConflictMessage: conflictMessage },
        { file: join(staging.path, "report.json"), data: `${JSON.stringify(report, null, 2)}\n`, inputConflictMessage: conflictMessage },
        { file: join(staging.path, "manifest.json"), data: `${JSON.stringify(manifest, null, 2)}\n`, inputConflictMessage: conflictMessage },
        { file: join(staging.path, "README.md"), data: formatHandoffReadme(report), inputConflictMessage: conflictMessage }
      ];
      await writeFilesDistinctFromInput(inputHandle, outputs, {
        exclusive: true,
        mode: 0o600,
        inputSnapshot
      });
      await assertInputSnapshotUnchanged(inputHandle, inputSnapshot);
      await publishStagingDirectory(staging, packageDir);
    } catch (error) {
      await removeFailedStaging(staging, error);
    }

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

interface OwnedStagingDirectory {
  path: string;
  identity: DirectoryIdentity;
}

interface DirectoryIdentity {
  dev: bigint;
  ino: bigint;
}

async function createOwnedStagingDirectory(
  rootDir: string,
  uid: string
): Promise<OwnedStagingDirectory> {
  await mkdir(rootDir, { recursive: true });
  const stagingPath = join(
    rootDir,
    `.trimctx-${uid}-${randomBytes(8).toString("hex")}.tmp`
  );
  try {
    await mkdir(stagingPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`handoff staging directory already exists: ${stagingPath}`, { cause: error });
    }
    throw error;
  }
  return {
    path: stagingPath,
    identity: await readDirectoryIdentity(stagingPath)
  };
}

async function publishStagingDirectory(
  staging: OwnedStagingDirectory,
  packageDir: string
): Promise<void> {
  // Node does not expose renameat2(RENAME_NOREPLACE). This preflight plus directory rename
  // preserves ordinary conflicts and non-empty concurrent targets, but is not a hostile-parent CAS:
  // on POSIX, an empty directory created between this check and rename can still be replaced.
  await assertOwnedStagingDirectory(staging);
  if (await directoryEntryExists(packageDir)) {
    throw new Error(`handoff package already exists: ${packageDir}`);
  }
  try {
    await rename(staging.path, packageDir);
  } catch (error) {
    if (await directoryEntryExists(packageDir)) {
      throw new Error(`handoff package already exists: ${packageDir}`, { cause: error });
    }
    throw error;
  }
}

async function removeFailedStaging(
  staging: OwnedStagingDirectory,
  operationError: unknown
): Promise<never> {
  try {
    await assertOwnedStagingDirectory(staging);
    await rm(staging.path, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      `Failed to create or safely clean up handoff package staging: ${staging.path}`
    );
  }
  throw operationError;
}

async function assertOwnedStagingDirectory(staging: OwnedStagingDirectory): Promise<void> {
  const currentIdentity = await readDirectoryIdentity(staging.path);
  if (!sameDirectoryIdentity(staging.identity, currentIdentity)) {
    throw new Error(`Refusing operation because staging directory identity changed: ${staging.path}`);
  }
}

async function readDirectoryIdentity(path: string): Promise<DirectoryIdentity> {
  const stats = await lstat(path, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.ino === 0n) {
    throw new Error(`Cannot establish reliable staging directory identity: ${path}`);
  }
  return { dev: stats.dev, ino: stats.ino };
}

async function directoryEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
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
