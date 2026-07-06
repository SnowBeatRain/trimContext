import { stat } from "node:fs/promises";
import { resolve } from "node:path";

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

export async function assertDifferentFiles(leftFile: string, rightFile: string, message: string): Promise<void> {
  if (await sameFile(leftFile, rightFile)) {
    throw new Error(message);
  }
}
