import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFileIfUnchanged } from "../platform/files.js";

export interface ClaudeMdSnapshot {
  content: string;
  bytes: Buffer;
}

export async function readClaudeMd(file: string): Promise<ClaudeMdSnapshot | undefined> {
  try {
    const bytes = await readFile(file);
    return { content: bytes.toString("utf8"), bytes };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Failed to read Claude context file: ${file}`, { cause: error });
  }
}

export async function writeClaudeMd(
  file: string,
  expected: ClaudeMdSnapshot | undefined,
  content: string
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await atomicWriteFileIfUnchanged(
    file,
    content,
    expected?.bytes,
    "CLAUDE.md changed while the Stop hook was preparing an update"
  );
}
