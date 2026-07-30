import { describe, expect, test } from "vitest";
import { link, mkdtemp, open, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertDifferentFiles, atomicWriteFileDistinctFromInput, sameFile } from "../src/platform/files.js";

describe("platform files", () => {
  test("treats identical resolved paths as the same file even before the target exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const file = join(dir, "missing.jsonl");

    await expect(sameFile(file, resolve(file))).resolves.toBe(true);
    await expect(assertDifferentFiles(file, resolve(file), "same file"))
      .rejects
      .toThrow("same file");
  });

  test("detects symlink aliases to an existing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const file = join(dir, "session.jsonl");
    const alias = join(dir, "alias.jsonl");
    await writeFile(file, "{}\n", "utf8");
    try {
      await symlink(file, alias);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await link(file, alias);
    }

    await expect(sameFile(file, alias)).resolves.toBe(true);
    await expect(assertDifferentFiles(file, alias, "refusing same file"))
      .rejects
      .toThrow("refusing same file");
  });

  test("allows different missing paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));

    await expect(sameFile(join(dir, "a.jsonl"), join(dir, "b.jsonl"))).resolves.toBe(false);
    await expect(assertDifferentFiles(join(dir, "a.jsonl"), join(dir, "b.jsonl"), "same file"))
      .resolves
      .toBeUndefined();
  });

  test("atomically replaces an existing output while preserving the input and cleaning temporary files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "report.json");
    await writeFile(input, "source\n", "utf8");
    await writeFile(output, "old report\n", "utf8");
    const inputHandle = await open(input, "r");

    try {
      await atomicWriteFileDistinctFromInput(inputHandle, output, "new report\n");
    } finally {
      await inputHandle.close();
    }

    expect(await readFile(input, "utf8")).toBe("source\n");
    expect(await readFile(output, "utf8")).toBe("new report\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("rejects an input alias without modifying it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const input = join(dir, "session.jsonl");
    const alias = join(dir, "alias.jsonl");
    await writeFile(input, "source\n", "utf8");
    try {
      await symlink(input, alias);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await link(input, alias);
    }
    const inputHandle = await open(input, "r");

    try {
      await expect(atomicWriteFileDistinctFromInput(inputHandle, alias, "replacement\n", "same file"))
        .rejects
        .toThrow("same file");
    } finally {
      await inputHandle.close();
    }

    expect(await readFile(input, "utf8")).toBe("source\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("preserves an existing target when the input changes before the atomic commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const output = join(dir, "report.json");
    await writeFile(output, "existing report\n", "utf8");
    const initialStat = { dev: 101, ino: 202, size: 10, mtimeMs: 1000, ctimeMs: 1000 };
    const changedStat = { ...initialStat, size: 11, mtimeMs: 1001, ctimeMs: 1001 };
    let statCalls = 0;
    const inputHandle = {
      stat: async () => statCalls++ === 0 ? initialStat : changedStat
    } as unknown as FileHandle;

    await expect(atomicWriteFileDistinctFromInput(inputHandle, output, "replacement\n"))
      .rejects
      .toThrow("Input file changed while output was being prepared");

    expect(await readFile(output, "utf8")).toBe("existing report\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });
});
