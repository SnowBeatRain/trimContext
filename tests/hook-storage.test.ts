import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { readClaudeMd, writeClaudeMd } from "../src/core/hook-storage.js";

describe("Claude hook context storage", () => {
  test("returns undefined only when CLAUDE.md is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-"));

    await expect(readClaudeMd(join(root, ".claude", "CLAUDE.md")))
      .resolves.toBeUndefined();
  });

  test("reads existing UTF-8 content and its exact byte snapshot", async () => {
    const file = await writeClaudeFixture("# Project\n");
    const snapshot = await readClaudeMd(file);

    expect(snapshot?.content).toBe("# Project\n");
    expect(snapshot?.bytes.equals(Buffer.from("# Project\n"))).toBe(true);
  });

  test("does not treat a non-ENOENT read failure as a missing file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-directory-"));

    await expect(readClaudeMd(directory)).rejects.toThrow(
      `Failed to read Claude context file: ${directory}`
    );
  });

  test("creates and atomically replaces CLAUDE.md without temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-"));
    const directory = join(root, ".claude");
    const file = join(directory, "CLAUDE.md");

    const missing = await readClaudeMd(file);
    await writeClaudeMd(file, missing, "first\n");
    const first = await readClaudeMd(file);
    await writeClaudeMd(file, first, "second\n");

    expect(await readFile(file, "utf8")).toBe("second\n");
    expect((await readdir(directory)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("rejects a stale managed-block write without overwriting concurrent bytes", async () => {
    const file = await writeClaudeFixture("# Project\n\nuser: A\n");
    const snapshot = await readClaudeMd(file);
    const concurrent = "# Project\n\nuser: B written after hook read\n";
    await writeFile(file, concurrent, "utf8");

    await expect(writeClaudeMd(file, snapshot, "stale A plus hook state\n"))
      .rejects.toThrow("CLAUDE.md changed while the Stop hook was preparing an update");

    expect(await readFile(file, "utf8")).toBe(concurrent);
    expect((await readdir(dirname(file))).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("does not overwrite a CLAUDE.md created after a missing read", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-race-"));
    const directory = join(root, ".claude");
    const file = join(directory, "CLAUDE.md");
    const snapshot = await readClaudeMd(file);
    await mkdir(directory, { recursive: true });
    await writeFile(file, "concurrent instructions\n", "utf8");

    await expect(writeClaudeMd(file, snapshot, "hook state\n"))
      .rejects.toThrow("CLAUDE.md changed while the Stop hook was preparing an update");

    expect(await readFile(file, "utf8")).toBe("concurrent instructions\n");
    expect((await readdir(directory)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });
});

async function writeClaudeFixture(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trimctx-hook-storage-"));
  const file = join(root, ".claude", "CLAUDE.md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}
