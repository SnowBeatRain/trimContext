import { describe, expect, test } from "vitest";
import { link, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  appendFileDistinctFromInput,
  assertDifferentFiles,
  atomicWriteFile,
  atomicWriteFileIfUnchanged,
  atomicWriteFileDistinctFromInput,
  sameFile
} from "../src/platform/files.js";

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

  test("rejects appending to the input path without changing its bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
    const input = join(dir, "session.jsonl");
    const original = "source transcript\n";
    await writeFile(input, original, "utf8");

    await expect(appendFileDistinctFromInput(
      input,
      input,
      "binding\n",
      "same file"
    )).rejects.toThrow("same file");

    expect(await readFile(input, "utf8")).toBe(original);
  });

  test("rejects appending through a hardlink to the input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "claude-env.sh");
    const original = "source transcript\n";
    await writeFile(input, original, "utf8");
    await link(input, output);

    await expect(appendFileDistinctFromInput(
      input,
      output,
      "binding\n",
      "same file"
    )).rejects.toThrow("same file");

    expect(await readFile(input, "utf8")).toBe(original);
    expect(await readFile(output, "utf8")).toBe(original);
  });

  test("appends to a distinct existing file without truncating it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "claude-env.sh");
    await writeFile(input, "source transcript\n", "utf8");
    await writeFile(output, "existing binding\n", "utf8");

    await appendFileDistinctFromInput(input, output, "new binding\n", "same file");

    expect(await readFile(input, "utf8")).toBe("source transcript\n");
    expect(await readFile(output, "utf8")).toBe("existing binding\nnew binding\n");
  });

  test("creates a distinct missing append target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "claude-env.sh");
    await writeFile(input, "source transcript\n", "utf8");

    await appendFileDistinctFromInput(input, output, "binding\n", "same file");

    expect(await readFile(input, "utf8")).toBe("source transcript\n");
    expect(await readFile(output, "utf8")).toBe("binding\n");
  });

  test("allows a distinct binding when the transcript is not created yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-"));
    const input = join(dir, "future-session.jsonl");
    const output = join(dir, "claude-env.sh");

    await appendFileDistinctFromInput(input, output, "binding\n", "same file");

    await expect(readFile(input)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(output, "utf8")).toBe("binding\n");
  });

  test("does not create the append target when input path inspection fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-append-preflight-"));
    const output = join(dir, "claude-env.sh");

    await expect(appendFileDistinctFromInput(
      "invalid\0transcript.jsonl",
      output,
      "binding\n"
    )).rejects.toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });

    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("atomically creates and replaces ordinary files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const output = join(dir, "settings.json");
    await writeFile(output, "old\n", "utf8");

    await atomicWriteFile(output, "new\n");

    expect(await readFile(output, "utf8")).toBe("new\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("atomically replaces a target whose bytes still match the expected snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
    const output = join(dir, "CLAUDE.md");
    const expected = Buffer.from("old instructions\n");
    await writeFile(output, expected);

    await atomicWriteFileIfUnchanged(output, "new instructions\n", expected, "target changed");

    expect(await readFile(output, "utf8")).toBe("new instructions\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("preserves changed target bytes when conditional atomic replacement conflicts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
    const output = join(dir, "CLAUDE.md");
    const expected = Buffer.from("old instructions\n");
    await writeFile(output, "concurrent instructions\n", "utf8");

    await expect(atomicWriteFileIfUnchanged(
      output,
      "new instructions\n",
      expected,
      "target changed"
    )).rejects.toThrow("target changed");

    expect(await readFile(output, "utf8")).toBe("concurrent instructions\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("does not recreate a conditional target deleted after its snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
    const output = join(dir, "CLAUDE.md");
    const expected = Buffer.from("deleted instructions\n");
    await writeFile(output, expected);
    await rm(output);

    await expect(atomicWriteFileIfUnchanged(
      output,
      "new instructions\n",
      expected,
      "target changed"
    )).rejects.toThrow("target changed");

    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("preserves a target created after an absent snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-"));
    const output = join(dir, "CLAUDE.md");
    await writeFile(output, "concurrent instructions\n", "utf8");

    await expect(atomicWriteFileIfUnchanged(
      output,
      "new instructions\n",
      undefined,
      "target changed"
    )).rejects.toThrow("target changed");

    expect(await readFile(output, "utf8")).toBe("concurrent instructions\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
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

  test("rejects an input changed after an earlier snapshot but before output preparation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "conversation.md");
    await writeFile(input, "original source\n", "utf8");
    await writeFile(output, "existing transcript\n", "utf8");
    const inputHandle = await open(input, "r");

    try {
      const inputSnapshot = await inputHandle.stat();
      await writeFile(input, "changed source with a different size\n", "utf8");

      await expect(atomicWriteFileDistinctFromInput(
        inputHandle,
        output,
        "replacement transcript\n",
        "same file",
        inputSnapshot
      )).rejects.toThrow("Input file changed while output was being prepared");
    } finally {
      await inputHandle.close();
    }

    expect(await readFile(output, "utf8")).toBe("existing transcript\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });
});
