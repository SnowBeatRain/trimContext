import { realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface Phase0SamplePlan {
  inputFile: string;
  sampleId: string;
  reportFile: string;
  compressedFile: string;
}

export function createPhase0RunPlan(files: string[], outputDir: string): Phase0SamplePlan[] {
  const sampleByOutputIdentity = new Map<string, { inputFile: string; sampleId: string }>();

  return files.map((inputFile) => {
    const inputName = basename(inputFile);
    const sampleId = sanitizeName(basename(inputFile, ".jsonl"));
    const outputIdentity = sampleIdIdentity(sampleId);
    const previousSample = sampleByOutputIdentity.get(outputIdentity);
    if (previousSample !== undefined) {
      if (previousSample.sampleId === sampleId) {
        throw new Error(
          `Phase 0 output name collision: "${basename(previousSample.inputFile)}" and "${inputName}" both map to "${sampleId}"`
        );
      }
      throw new Error(
        `Phase 0 output name collision: "${basename(previousSample.inputFile)}" and "${inputName}" map to case-equivalent IDs "${previousSample.sampleId}" and "${sampleId}"`
      );
    }
    sampleByOutputIdentity.set(outputIdentity, { inputFile, sampleId });

    return {
      inputFile,
      sampleId,
      reportFile: join(outputDir, `${sampleId}.report.json`),
      compressedFile: join(outputDir, `${sampleId}.trimmed.jsonl`)
    };
  });
}

export async function assertDistinctPhase0Directories(inputDir: string, outputDir: string): Promise<void> {
  const canonicalInputDir = await realpath(inputDir);
  const canonicalOutputDir = await realpathIfExists(outputDir);
  if (directoryIdentity(canonicalInputDir) === directoryIdentity(canonicalOutputDir)) {
    throw new Error("--dir and --out must refer to different directories");
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "sample";
}

function sampleIdIdentity(sampleId: string): string {
  return process.platform === "win32" ? sampleId.toLowerCase() : sampleId;
}

async function realpathIfExists(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return resolve(path);
    }
    throw error;
  }
}

function directoryIdentity(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
