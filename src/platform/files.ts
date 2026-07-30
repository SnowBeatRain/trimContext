import { constants, type Stats } from "node:fs";
import { randomBytes } from "node:crypto";
import { access, open, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

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

export async function atomicWriteFileDistinctFromInput(
  inputHandle: FileHandle,
  outputFile: string,
  data: string,
  conflictMessage = "Output file must be different from input file"
): Promise<void> {
  const inputStat = await inputHandle.stat();
  await assertOutputIsDistinct(inputStat, outputFile, conflictMessage);

  const directory = dirname(outputFile);
  const outputName = basename(outputFile);
  const tempFile = join(directory, `.${outputName}.trimctx-${randomBytes(8).toString("hex")}.tmp`);
  let tempHandle: FileHandle | undefined;

  try {
    tempHandle = await open(tempFile, "wx");
    await tempHandle.writeFile(data, "utf8");
    await tempHandle.close();
    tempHandle = undefined;

    const currentInputStat = await inputHandle.stat();
    if (!sameInputSnapshot(inputStat, currentInputStat)) {
      throw new Error("Input file changed while output was being prepared");
    }
    await assertOutputIsDistinct(currentInputStat, outputFile, conflictMessage);

    try {
      await rename(tempFile, outputFile);
    } catch (error) {
      if (!shouldUseWindowsReplacement(error) || !await isRegularFile(outputFile)) throw error;
      await replaceExistingWindowsFile(tempFile, outputFile);
    }
  } finally {
    await tempHandle?.close().catch(() => undefined);
    await rm(tempFile, { force: true }).catch(() => undefined);
  }
}

function sameInputSnapshot(initial: Stats, current: Stats): boolean {
  return initial.dev === current.dev
    && initial.ino === current.ino
    && initial.size === current.size
    && initial.mtimeMs === current.mtimeMs
    && initial.ctimeMs === current.ctimeMs;
}

async function assertOutputIsDistinct(inputStat: Stats, outputFile: string, message: string): Promise<void> {
  try {
    const outputStat = await stat(outputFile);
    if (inputStat.dev === outputStat.dev && inputStat.ino === outputStat.ino) {
      throw new Error(message);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function shouldUseWindowsReplacement(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return process.platform === "win32" && (code === "EEXIST" || code === "EPERM");
}

async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function replaceExistingWindowsFile(tempFile: string, outputFile: string): Promise<void> {
  const backupFile = join(
    dirname(outputFile),
    `.${basename(outputFile)}.trimctx-${randomBytes(8).toString("hex")}.bak`
  );
  await rename(outputFile, backupFile);
  try {
    await rename(tempFile, outputFile);
  } catch (error) {
    try {
      await rename(backupFile, outputFile);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Failed to replace and restore ${outputFile}`);
    }
    throw error;
  }
  await rm(backupFile, { force: true });
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
