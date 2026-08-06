import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { compressFile } from "../src/core/compressor.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: vi.fn(actual.open)
  };
});

afterEach(async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(open).mockImplementation(actualFs.open);
});

describe("compressor output failure safety", () => {
  test("preserves an existing compressed copy when staged writing fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-compress-write-failure-"));
    const input = join(root, "session.jsonl");
    const output = join(root, "session.trimmed.jsonl");
    const originalInput = '{"role":"user","content":"hello"}\n';
    const existingOutput = "existing compressed copy\n";
    await writeFile(input, originalInput, "utf8");
    await writeFile(output, existingOutput, "utf8");
    const inputHash = await sha256(input);
    const writeError = Object.assign(new Error("injected compressed output write failure"), {
      code: "EIO"
    });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      if (flags === "r") return handle;
      Object.defineProperty(handle, "writeFile", {
        configurable: true,
        value: async () => {
          throw writeError;
        }
      });
      return handle;
    });

    let caught: unknown;
    try {
      await compressFile(input, output);
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
    }

    try {
      expect(caught).toBe(writeError);
      expect(await readFile(output, "utf8")).toBe(existingOutput);
      expect(await sha256(input)).toBe(inputHash);
      expect(await transactionArtifacts(root)).toEqual([]);
    } finally {
      await actualFs.rm(root, { recursive: true, force: true });
    }
  });

  test("rejects an input changed after reading before atomic commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-compress-input-change-"));
    const input = join(root, "session.jsonl");
    const output = join(root, "session.trimmed.jsonl");
    const originalInput = '{"role":"user","content":"hello"}\n';
    const changedInput = '{"role":"user","content":"changed while compressing"}\n';
    const existingOutput = "existing compressed copy\n";
    await writeFile(input, originalInput, "utf8");
    await writeFile(output, existingOutput, "utf8");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let inputMutated = false;
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      if (flags !== "r" && !inputMutated) {
        inputMutated = true;
        await actualFs.writeFile(input, changedInput, "utf8");
      }
      return handle;
    });

    let caught: unknown;
    try {
      await compressFile(input, output);
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
    }

    try {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Input file changed while output was being prepared");
      expect(await readFile(input, "utf8")).toBe(changedInput);
      expect(await readFile(output, "utf8")).toBe(existingOutput);
      expect(await transactionArtifacts(root)).toEqual([]);
    } finally {
      await actualFs.rm(root, { recursive: true, force: true });
    }
  });
});

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function transactionArtifacts(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((name) => name.includes(".trimctx-"));
}
