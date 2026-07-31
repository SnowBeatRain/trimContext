import { mkdtemp, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { atomicWriteFileDistinctFromInput } from "../src/platform/files.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename)
  };
});

describe("platform file failure handling", () => {
  test("preserves the input and existing target when the atomic commit rename fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-failure-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "conversation.md");
    await writeFile(input, "source transcript\n", "utf8");
    await writeFile(output, "existing transcript\n", "utf8");
    const inputHandle = await open(input, "r");
    const commitError = Object.assign(new Error("injected atomic commit failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockRejectedValueOnce(commitError);

    try {
      await expect(atomicWriteFileDistinctFromInput(
        inputHandle,
        output,
        "replacement transcript\n"
      )).rejects.toThrow("injected atomic commit failure");
    } finally {
      await inputHandle.close();
    }

    expect(await readFile(input, "utf8")).toBe("source transcript\n");
    expect(await readFile(output, "utf8")).toBe("existing transcript\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });
});
