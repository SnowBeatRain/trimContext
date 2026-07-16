import { constants } from "node:fs";
import { access, open, stat, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function sameFile(leftFile: string, rightFile: string): Promise<boolean> {
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

export async function assertDifferentFiles(
  leftFile: string,
  rightFile: string,
  message: string
): Promise<void> {
  if (await sameFile(leftFile, rightFile)) {
    throw new Error(message);
  }
}

export async function writeFileDistinctFromInput(
  inputHandle: FileHandle,
  outputFile: string,
  data: string,
  conflictMessage = "Output file must be different from input file"
): Promise<void> {
  await writeFilesDistinctFromInput(inputHandle, [
    {
      file: outputFile,
      data,
      inputConflictMessage: conflictMessage
    }
  ]);
}

export interface DistinctFileOutput {
  file: string;
  data: string;
  inputConflictMessage?: string;
  outputConflictMessage?: string;
}

export async function writeFilesDistinctFromInput(
  inputHandle: FileHandle,
  outputs: readonly DistinctFileOutput[]
): Promise<void> {
  const outputHandles: FileHandle[] = [];
  try {
    for (const output of outputs) {
      outputHandles.push(await open(output.file, constants.O_WRONLY | constants.O_CREAT));
    }

    const [inputStat, ...outputStats] = await Promise.all([
      inputHandle.stat(),
      ...outputHandles.map((handle) => handle.stat())
    ]);
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const outputStat = outputStats[index];
      if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
        throw new Error(output.inputConflictMessage ?? "Output file must be different from input file");
      }

      for (let previous = 0; previous < index; previous += 1) {
        const previousStat = outputStats[previous];
        if (previousStat.dev === outputStat.dev && previousStat.ino === outputStat.ino) {
          throw new Error(output.outputConflictMessage ?? "Output files must be different");
        }
      }
    }

    for (let index = 0; index < outputs.length; index += 1) {
      await outputHandles[index].truncate(0);
      await outputHandles[index].writeFile(outputs[index].data, "utf8");
    }
  } finally {
    await Promise.all(outputHandles.map((handle) => handle.close()));
  }
}
