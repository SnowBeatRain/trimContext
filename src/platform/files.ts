import { constants, type Stats } from "node:fs";
import { randomBytes } from "node:crypto";
import { access, open, readFile, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function sameFile(leftFile: string, rightFile: string): Promise<boolean> {
  if (sameResolvedPath(leftFile, rightFile)) {
    return true;
  }
  const [leftIdentity, rightIdentity] = await Promise.all([
    statIdentityIfExists(leftFile),
    statIdentityIfExists(rightFile)
  ]);
  return leftIdentity !== undefined
    && rightIdentity !== undefined
    && sameReliableFileIdentity(leftIdentity, rightIdentity);
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
  conflictMessage = "Output file must be different from input file",
  inputSnapshot?: Stats
): Promise<void> {
  const inputStat = inputSnapshot ?? await inputHandle.stat();
  const inputIdentity = await fileHandleIdentity(inputHandle);
  await assertInputSnapshotUnchanged(inputHandle, inputStat);
  await assertOutputIsDistinct(inputIdentity, outputFile, conflictMessage);

  await writeAtomicFile(outputFile, data, async () => {
    await assertInputSnapshotUnchanged(inputHandle, inputStat);
    const currentInputIdentity = await fileHandleIdentity(inputHandle);
    await assertOutputIsDistinct(currentInputIdentity, outputFile, conflictMessage);
  });
}

export async function atomicWriteFile(outputFile: string, data: string): Promise<void> {
  await writeAtomicFile(outputFile, data);
}

export async function atomicWriteFileIfUnchanged(
  outputFile: string,
  data: string,
  expectedContent: Uint8Array | undefined,
  conflictMessage = "Output file changed while update was being prepared"
): Promise<void> {
  const snapshot = expectedContent === undefined ? undefined : Buffer.from(expectedContent);
  const assertUnchanged = async (): Promise<void> => {
    await assertFileContentUnchanged(outputFile, snapshot, conflictMessage);
  };
  await assertUnchanged();
  await writeAtomicFile(outputFile, data, assertUnchanged);
}

async function writeAtomicFile(
  outputFile: string,
  data: string,
  beforeCommit?: () => Promise<void>
): Promise<void> {
  const directory = dirname(outputFile);
  const outputName = basename(outputFile);
  const tempFile = join(directory, `.${outputName}.trimctx-${randomBytes(8).toString("hex")}.tmp`);
  let tempHandle: FileHandle | undefined;
  let ownsTempPath = false;
  let operationFailed = false;
  let operationError: unknown;

  try {
    tempHandle = await open(tempFile, "wx");
    ownsTempPath = true;
    await tempHandle.writeFile(data, "utf8");
    await tempHandle.close();
    tempHandle = undefined;

    await beforeCommit?.();

    try {
      await rename(tempFile, outputFile);
      ownsTempPath = false;
    } catch (error) {
      if (!shouldUseWindowsReplacement(error)) throw error;
      let outputIsRegularFile: boolean;
      try {
        outputIsRegularFile = await isRegularFile(outputFile);
      } catch (inspectionError) {
        throw new AggregateError(
          [...errorComponents(error), ...errorComponents(inspectionError)],
          `Failed to replace or inspect existing atomic output: ${outputFile}`
        );
      }
      if (!outputIsRegularFile) throw error;
      await beforeCommit?.();
      await replaceExistingWindowsFile(tempFile, outputFile, () => {
        ownsTempPath = false;
      });
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (tempHandle !== undefined) {
      try {
        await tempHandle.close();
      } catch (error) {
        cleanupErrors.push(...errorComponents(error));
      }
    }
    if (ownsTempPath) {
      try {
        await rm(tempFile, { force: true });
      } catch (error) {
        cleanupErrors.push(...errorComponents(error));
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [
          ...(operationFailed ? errorComponents(operationError) : []),
          ...cleanupErrors
        ],
        `Failed to write or clean up atomic output: ${outputFile}`
      );
    }
  }
}

export async function appendFileDistinctFromInput(
  inputFile: string,
  outputFile: string,
  data: string,
  conflictMessage = "Output file must be different from input file"
): Promise<void> {
  if (sameResolvedPath(inputFile, outputFile)) {
    throw new Error(conflictMessage);
  }

  let outputHandle: FileHandle | undefined;
  let inputHandle: FileHandle | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    inputHandle = await openFileIfExists(inputFile, "r");
    outputHandle = await open(
      outputFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
    );
    if (inputHandle !== undefined) {
      const [outputStat, inputStat] = await Promise.all([
        fileHandleIdentity(outputHandle),
        fileHandleIdentity(inputHandle)
      ]);
      if (sameReliableFileIdentity(outputStat, inputStat)) {
        throw new Error(conflictMessage);
      }
    }
    await outputHandle.writeFile(data, "utf8");
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  const handles = [outputHandle, inputHandle]
    .filter((handle): handle is FileHandle => handle !== undefined);
  const closeResults = await Promise.allSettled(handles.map((handle) => handle.close()));
  const closeErrors = closeResults.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );

  if (operationFailed && closeErrors.length === 0) throw operationError;
  if (!operationFailed && closeErrors.length === 1) throw closeErrors[0];
  if (operationFailed || closeErrors.length > 0) {
    throw new AggregateError(
      [
        ...(operationFailed ? errorComponents(operationError) : []),
        ...closeErrors
      ],
      `Failed to append or close distinct output: ${outputFile}`
    );
  }
}

async function assertInputSnapshotUnchanged(inputHandle: FileHandle, initial: Stats): Promise<Stats> {
  const current = await inputHandle.stat();
  if (!sameInputSnapshot(initial, current)) {
    throw new Error("Input file changed while output was being prepared");
  }
  return current;
}

async function assertFileContentUnchanged(
  file: string,
  expectedContent: Buffer | undefined,
  conflictMessage: string
): Promise<void> {
  let currentContent: Buffer;
  try {
    currentContent = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (expectedContent === undefined) return;
      throw new Error(conflictMessage);
    }
    throw error;
  }
  if (expectedContent === undefined || !currentContent.equals(expectedContent)) {
    throw new Error(conflictMessage);
  }
}

function sameInputSnapshot(initial: Stats, current: Stats): boolean {
  return initial.dev === current.dev
    && initial.ino === current.ino
    && initial.size === current.size
    && initial.mtimeMs === current.mtimeMs
    && initial.ctimeMs === current.ctimeMs;
}

async function assertOutputIsDistinct(
  inputIdentity: FileIdentity,
  outputFile: string,
  message: string
): Promise<void> {
  const outputIdentity = await statIdentityIfExists(outputFile);
  if (outputIdentity !== undefined && sameReliableFileIdentity(inputIdentity, outputIdentity)) {
    throw new Error(message);
  }
}

function shouldUseWindowsReplacement(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return process.platform === "win32" && (code === "EEXIST" || code === "EPERM");
}

async function isRegularFile(file: string): Promise<boolean> {
  return (await statIfExists(file))?.isFile() ?? false;
}

async function statIfExists(file: string): Promise<Stats | undefined> {
  try {
    return await stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

async function statIdentityIfExists(file: string): Promise<FileIdentity | undefined> {
  try {
    return toFileIdentity(await stat(file, { bigint: true }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function fileHandleIdentity(handle: FileHandle): Promise<FileIdentity> {
  return toFileIdentity(await handle.stat({ bigint: true }));
}

function toFileIdentity(stats: { dev: bigint | number; ino: bigint | number }): FileIdentity {
  return {
    dev: BigInt(stats.dev),
    ino: BigInt(stats.ino)
  };
}

function sameReliableFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return hasReliableFileIdentity(left)
    && hasReliableFileIdentity(right)
    && left.dev === right.dev
    && left.ino === right.ino;
}

function hasReliableFileIdentity(identity: FileIdentity): boolean {
  return identity.ino !== 0n;
}

function sameResolvedPath(leftFile: string, rightFile: string): boolean {
  const left = resolve(leftFile);
  const right = resolve(rightFile);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function openFileIfExists(
  file: string,
  flags: "r"
): Promise<FileHandle | undefined> {
  try {
    return await open(file, flags);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function replaceExistingWindowsFile(
  tempFile: string,
  outputFile: string,
  onTempMoved: () => void
): Promise<void> {
  const backupFile = join(
    dirname(outputFile),
    `.${basename(outputFile)}.trimctx-${randomBytes(8).toString("hex")}.bak`
  );
  await rename(outputFile, backupFile);
  try {
    await rename(tempFile, outputFile);
    onTempMoved();
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

function errorComponents(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap((component) => errorComponents(component))
    : [error];
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
  let operationFailed = false;
  let operationError: unknown;
  try {
    for (const output of outputs) {
      outputHandles.push(await open(output.file, constants.O_WRONLY | constants.O_CREAT));
    }

    const [inputIdentity, ...outputIdentities] = await Promise.all([
      fileHandleIdentity(inputHandle),
      ...outputHandles.map((handle) => fileHandleIdentity(handle))
    ]);
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      const outputIdentity = outputIdentities[index];
      if (sameReliableFileIdentity(inputIdentity, outputIdentity)) {
        throw new Error(output.inputConflictMessage ?? "Output file must be different from input file");
      }

      for (let previous = 0; previous < index; previous += 1) {
        const previousIdentity = outputIdentities[previous];
        if (
          sameResolvedPath(outputs[previous].file, output.file)
          || sameReliableFileIdentity(previousIdentity, outputIdentity)
        ) {
          throw new Error(output.outputConflictMessage ?? "Output files must be different");
        }
      }
    }

    for (let index = 0; index < outputs.length; index += 1) {
      await outputHandles[index].truncate(0);
      await outputHandles[index].writeFile(outputs[index].data, "utf8");
    }
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  const closeResults = await Promise.allSettled(outputHandles.map((handle) => handle.close()));
  const closeErrors = closeResults.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );

  if (operationFailed && closeErrors.length === 0) throw operationError;
  if (!operationFailed && closeErrors.length === 1) throw closeErrors[0];
  if (operationFailed || closeErrors.length > 0) {
    throw new AggregateError(
      [
        ...(operationFailed ? errorComponents(operationError) : []),
        ...closeErrors
      ],
      `Failed to write or close distinct outputs: ${outputs.map((output) => output.file).join(", ")}`
    );
  }
}
