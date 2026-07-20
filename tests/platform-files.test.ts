import { describe, expect, test } from "vitest";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertDifferentFiles, sameFile } from "../src/platform/files.js";

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
    await symlink(file, alias);

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
});
