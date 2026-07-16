import { link, mkdtemp, open, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  assertDifferentFiles,
  pathExists,
  sameFile,
  writeFileDistinctFromInput,
  writeFilesDistinctFromInput
} from "../src/platform/files.js";

describe("file safety", () => {
  test("recognizes the same resolved path and rejects it with the caller message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const file = join(dir, "session.jsonl");
    await writeFile(file, "{}\n", "utf8");

    await expect(sameFile(file, join(dir, ".", "session.jsonl"))).resolves.toBe(true);
    await expect(assertDifferentFiles(file, file, "output conflicts with input")).rejects.toThrow(
      "output conflicts with input"
    );
  });

  test("treats distinct missing paths as different and reports existence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const left = join(dir, "left.jsonl");
    const right = join(dir, "right.jsonl");

    await expect(sameFile(left, right)).resolves.toBe(false);
    await expect(pathExists(left)).resolves.toBe(false);
    await writeFile(left, "{}\n", "utf8");
    await expect(pathExists(left)).resolves.toBe(true);
  });

  test("overwrites a distinct existing output through the checked file handle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "report.json");
    await writeFile(input, "original transcript\n", "utf8");
    await writeFile(output, "stale output that is longer\n", "utf8");

    const inputHandle = await open(input, "r");
    try {
      await writeFileDistinctFromInput(inputHandle, output, "fresh output\n");
    } finally {
      await inputHandle.close();
    }

    await expect(readFile(input, "utf8")).resolves.toBe("original transcript\n");
    await expect(readFile(output, "utf8")).resolves.toBe("fresh output\n");
  });

  test("rejects a hard-linked output without changing the input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "output.jsonl");
    const original = "original transcript\n";
    await writeFile(input, original, "utf8");
    await link(input, output);

    const inputHandle = await open(input, "r");
    try {
      await expect(
        writeFileDistinctFromInput(inputHandle, output, "replacement\n", "output conflicts with input")
      ).rejects.toThrow("output conflicts with input");
    } finally {
      await inputHandle.close();
    }
    await expect(readFile(input, "utf8")).resolves.toBe(original);
  });

  test("protects the opened input after its path is replaced", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "output.jsonl");
    const original = "original transcript\n";
    await writeFile(input, original, "utf8");

    const inputHandle = await open(input, "r");
    try {
      await expect(inputHandle.readFile("utf8")).resolves.toBe(original);
      await rename(input, output);
      await writeFile(input, "replacement path\n", "utf8");

      await expect(
        writeFileDistinctFromInput(inputHandle, output, "unsafe replacement\n")
      ).rejects.toThrow("Output file must be different from input file");
    } finally {
      await inputHandle.close();
    }

    await expect(readFile(output, "utf8")).resolves.toBe(original);
    await expect(readFile(input, "utf8")).resolves.toBe("replacement path\n");
  });

  test("rejects output files that share an identity before truncating either one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-file-safety-"));
    const input = join(dir, "session.jsonl");
    const handoff = join(dir, "handoff.md");
    const nextContext = join(dir, "next-context.md");
    await writeFile(input, "original transcript\n", "utf8");
    await writeFile(handoff, "existing handoff\n", "utf8");
    await link(handoff, nextContext);

    const inputHandle = await open(input, "r");
    try {
      await expect(
        writeFilesDistinctFromInput(inputHandle, [
          { file: handoff, data: "new handoff\n" },
          {
            file: nextContext,
            data: "new next context\n",
            outputConflictMessage: "next context conflicts with handoff"
          }
        ])
      ).rejects.toThrow("next context conflicts with handoff");
    } finally {
      await inputHandle.close();
    }

    await expect(readFile(handoff, "utf8")).resolves.toBe("existing handoff\n");
  });
});
