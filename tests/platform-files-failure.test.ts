import { access, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  appendFileDistinctFromInput,
  atomicWriteFile,
  atomicWriteFileIfUnchanged,
  atomicWriteFileDistinctFromInput,
  pathExists,
  sameFile,
  writeFilesDistinctFromInput
} from "../src/platform/files.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: vi.fn(actual.access),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm),
    stat: vi.fn(actual.stat)
  };
});

describe("platform file failure handling", () => {
  test("propagates existence-check errors other than missing paths", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const accessError = Object.assign(new Error("injected path access failure"), {
      code: "EACCES"
    });
    vi.mocked(access).mockRejectedValueOnce(accessError);

    await expect(pathExists("inaccessible-output"))
      .rejects
      .toBe(accessError);

    vi.mocked(access).mockImplementation(actualFs.access);
  });

  test("propagates file identity errors other than missing paths", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const statError = Object.assign(new Error("injected file identity failure"), {
      code: "EACCES"
    });
    vi.mocked(stat).mockRejectedValueOnce(statError);

    try {
      await expect(sameFile("inaccessible-left", "inaccessible-right"))
        .rejects
        .toBe(statError);
    } finally {
      vi.mocked(stat).mockImplementation(actualFs.stat);
    }
  });

  test("uses bigint file identities when numeric inode values collide", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const collidingNumberInode = 38_562_071_809_943_040;
    vi.mocked(stat).mockImplementation(async (path, options) => {
      const bigint = typeof options === "object" && options !== null && "bigint" in options && options.bigint;
      if (bigint) {
        return {
          dev: 1n,
          ino: String(path).includes("left")
            ? 38_562_071_809_943_036n
            : 38_562_071_809_943_038n
        } as never;
      }
      return { dev: 1, ino: collidingNumberInode } as never;
    });

    try {
      await expect(sameFile("left.jsonl", "right.jsonl")).resolves.toBe(false);
    } finally {
      vi.mocked(stat).mockImplementation(actualFs.stat);
    }
  });

  test("does not delete an unowned temp path when exclusive open fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-open-failure-"));
    const output = join(dir, "settings.json");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const openError = Object.assign(new Error("injected atomic temp ownership conflict"), {
      code: "EEXIST"
    });
    let foreignTemp = "";
    vi.mocked(rm).mockClear().mockImplementation(actualFs.rm);
    vi.mocked(open).mockImplementationOnce(async (path) => {
      foreignTemp = String(path);
      await actualFs.writeFile(foreignTemp, "other owner\n", "utf8");
      throw openError;
    });

    try {
      await expect(atomicWriteFile(output, "replacement settings\n"))
        .rejects.toBe(openError);

      expect(rm).not.toHaveBeenCalled();
      expect(await readFile(foreignTemp, "utf8")).toBe("other owner\n");
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

  test("does not remove the old temp name after a successful commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-commit-ownership-"));
    const output = join(dir, "settings.json");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rm).mockClear().mockImplementation(actualFs.rm);

    try {
      await atomicWriteFile(output, "replacement settings\n");

      expect(await readFile(output, "utf8")).toBe("replacement settings\n");
      expect(rm).not.toHaveBeenCalled();
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

  test("preserves target bytes changed while a conditional temp file is staged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cas-staging-"));
    const output = join(dir, "CLAUDE.md");
    const expected = Buffer.from("old instructions\n");
    await writeFile(output, expected);
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      const write = handle.writeFile.bind(handle);
      Object.defineProperty(handle, "writeFile", {
        configurable: true,
        value: async (...args: Parameters<FileHandle["writeFile"]>) => {
          await write(...args);
          await actualFs.writeFile(output, "concurrent instructions\n", "utf8");
        }
      });
      return handle;
    });

    try {
      await expect(atomicWriteFileIfUnchanged(
        output,
        "new instructions\n",
        expected,
        "target changed"
      )).rejects.toThrow("target changed");

      expect(await actualFs.readFile(output, "utf8")).toBe("concurrent instructions\n");
      expect((await actualFs.readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
    } finally {
      vi.mocked(open).mockReset().mockImplementation(actualFs.open);
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

  test("reports append operation and every handle close failure", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const operationError = new Error("injected append failure");
    const outputCloseError = new Error("injected append output close failure");
    const inputCloseError = new Error("injected append input close failure");
    const outputHandle = {
      stat: async () => ({ dev: 1, ino: 2 }),
      writeFile: async () => { throw operationError; },
      close: async () => { throw outputCloseError; }
    } as unknown as FileHandle;
    const inputHandle = {
      stat: async () => ({ dev: 1, ino: 1 }),
      close: async () => { throw inputCloseError; }
    } as unknown as FileHandle;
    vi.mocked(open).mockImplementation(async (path) =>
      String(path) === "input.jsonl" ? inputHandle : outputHandle
    );

    let caught: unknown;
    try {
      await appendFileDistinctFromInput("input.jsonl", "env.sh", "binding\n");
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockReset().mockImplementation(actualFs.open);
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      operationError,
      outputCloseError,
      inputCloseError
    ]);
  });

  test("reports operation close, cleanup close, and temp cleanup errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-close-failure-"));
    const output = join(dir, "settings.json");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const operationCloseError = Object.assign(new Error("injected atomic operation close failure"), {
      code: "EIO"
    });
    const cleanupCloseError = Object.assign(new Error("injected atomic cleanup close failure"), {
      code: "EIO"
    });
    const cleanupRmError = Object.assign(new Error("injected atomic temp cleanup failure"), {
      code: "EACCES"
    });
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      const close = handle.close.bind(handle);
      let closeCalls = 0;
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async () => {
          closeCalls += 1;
          if (closeCalls === 1) throw operationCloseError;
          await close();
          throw cleanupCloseError;
        }
      });
      return handle;
    });
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (String(path).endsWith(".tmp")) throw cleanupRmError;
      await actualFs.rm(path, options);
    });

    let caught: unknown;
    try {
      await atomicWriteFile(output, "replacement settings\n");
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      vi.mocked(rm).mockImplementation(actualFs.rm);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const messages = (caught as AggregateError).errors.map(String).join("\n");
      expect(messages).toContain("injected atomic operation close failure");
      expect(messages).toContain("injected atomic cleanup close failure");
      expect(messages).toContain("injected atomic temp cleanup failure");
      const tempFiles = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
      expect(tempFiles).toHaveLength(1);
      expect(await readFile(join(dir, tempFiles[0]!), "utf8")).toBe("replacement settings\n");
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

  test("reports a distinct-writer operation failure and every close failure", async () => {
    const operationError = new Error("injected distinct writer operation failure");
    const firstCloseError = new Error("injected first output close failure");
    const secondCloseError = new Error("injected second output close failure");

    const caught = await captureDistinctWriterFailure([
      { closeError: firstCloseError },
      { writeError: operationError, closeError: secondCloseError }
    ]);

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      operationError,
      firstCloseError,
      secondCloseError
    ]);
  });

  test("reports every close failure after successful distinct writes", async () => {
    const firstCloseError = new Error("injected first successful-write close failure");
    const secondCloseError = new Error("injected second successful-write close failure");

    const caught = await captureDistinctWriterFailure([
      { closeError: firstCloseError },
      { closeError: secondCloseError }
    ]);

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([firstCloseError, secondCloseError]);
  });

  test("preserves lone distinct-writer operation and close error identities", async () => {
    const operationError = new Error("injected lone distinct writer operation failure");
    const closeError = new Error("injected lone distinct writer close failure");

    await expect(captureDistinctWriterFailure([{ writeError: operationError }]))
      .resolves
      .toBe(operationError);
    await expect(captureDistinctWriterFailure([{ closeError }]))
      .resolves
      .toBe(closeError);
  });

  test("distinct writer uses bigint identities when numeric output inode values collide", async () => {
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const inputHandle = {
      stat: async (options?: { bigint?: boolean }) => options?.bigint
        ? ({ dev: 1n, ino: 10n })
        : ({ dev: 1, ino: 10 })
    } as unknown as FileHandle;
    const writes: string[] = [];
    const collidingNumberInode = 38_562_071_809_943_040;
    const outputHandles = [
      {
        stat: async (options?: { bigint?: boolean }) => options?.bigint
          ? ({ dev: 2n, ino: 38_562_071_809_943_036n })
          : ({ dev: 2, ino: collidingNumberInode }),
        truncate: async () => undefined,
        writeFile: async (data: string) => { writes.push(data); },
        close: async () => undefined
      },
      {
        stat: async (options?: { bigint?: boolean }) => options?.bigint
          ? ({ dev: 2n, ino: 38_562_071_809_943_038n })
          : ({ dev: 2, ino: collidingNumberInode }),
        truncate: async () => undefined,
        writeFile: async (data: string) => { writes.push(data); },
        close: async () => undefined
      }
    ] as unknown as FileHandle[];

    for (const handle of outputHandles) {
      vi.mocked(open).mockResolvedValueOnce(handle);
    }

    try {
      await writeFilesDistinctFromInput(inputHandle, [
        { file: "first.md", data: "first\n" },
        { file: "second.md", data: "second\n" }
      ]);
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
    }

    expect(writes).toEqual(["first\n", "second\n"]);
  });

  test.skipIf(process.platform !== "win32")(
    "does not remove the old temp name after Windows replacement transfers ownership",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "trimctx-files-windows-transfer-"));
      const output = join(dir, "settings.json");
      await writeFile(output, "existing settings\n", "utf8");
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const backupCleanupError = Object.assign(new Error("injected atomic backup cleanup failure"), {
        code: "EACCES"
      });
      const replacementSignalError = Object.assign(new Error("injected Windows replacement signal"), {
        code: "EPERM"
      });
      let tempRmCalls = 0;
      vi.mocked(rename).mockRejectedValueOnce(replacementSignalError);
      vi.mocked(rm).mockImplementation(async (path, options) => {
        const target = String(path);
        if (target.endsWith(".bak")) throw backupCleanupError;
        if (target.endsWith(".tmp")) tempRmCalls += 1;
        await actualFs.rm(path, options);
      });

      try {
        await expect(atomicWriteFile(output, "replacement settings\n"))
          .rejects.toBe(backupCleanupError);

        expect(tempRmCalls).toBe(0);
        expect(await readFile(output, "utf8")).toBe("replacement settings\n");
        const backupFiles = (await readdir(dir)).filter((name) => name.endsWith(".bak"));
        expect(backupFiles).toHaveLength(1);
        expect(await readFile(join(dir, backupFiles[0]!), "utf8")).toBe("existing settings\n");
      } finally {
        vi.mocked(rm).mockImplementation(actualFs.rm);
        await actualFs.rm(dir, { recursive: true, force: true });
      }
    }
  );

  test.skipIf(process.platform !== "win32")(
    "preserves a target changed after the first Windows rename attempt",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "trimctx-files-windows-cas-"));
      const output = join(dir, "CLAUDE.md");
      const expected = Buffer.from("old instructions\n");
      await writeFile(output, expected);
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const replacementSignal = Object.assign(new Error("injected Windows replacement signal"), {
        code: "EPERM"
      });
      vi.mocked(rename).mockImplementationOnce(async () => {
        await actualFs.writeFile(output, "concurrent instructions\n", "utf8");
        throw replacementSignal;
      });

      try {
        await expect(atomicWriteFileIfUnchanged(
          output,
          "new instructions\n",
          expected,
          "target changed"
        )).rejects.toThrow("target changed");

        expect(await actualFs.readFile(output, "utf8")).toBe("concurrent instructions\n");
        expect((await actualFs.readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
      } finally {
        vi.mocked(rename).mockReset().mockImplementation(actualFs.rename);
        await actualFs.rm(dir, { recursive: true, force: true });
      }
    }
  );

  test.skipIf(process.platform !== "win32")(
    "reports both Windows replacement and target inspection failures",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "trimctx-files-windows-inspection-"));
      const output = join(dir, "settings.json");
      await writeFile(output, "existing settings\n", "utf8");
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      const renameError = Object.assign(new Error("injected Windows replacement failure"), {
        code: "EPERM"
      });
      const statError = Object.assign(new Error("injected Windows target inspection failure"), {
        code: "EACCES"
      });
      vi.mocked(rename).mockRejectedValueOnce(renameError);
      vi.mocked(stat).mockRejectedValueOnce(statError);

      let caught: unknown;
      try {
        await atomicWriteFile(output, "replacement settings\n");
      } catch (error) {
        caught = error;
      } finally {
        vi.mocked(stat).mockImplementation(actualFs.stat);
      }

      try {
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).errors).toEqual([renameError, statError]);
        expect(await readFile(output, "utf8")).toBe("existing settings\n");
        expect((await readdir(dir)).filter((name) => name.includes(".trimctx-"))).toEqual([]);
      } finally {
        await actualFs.rm(dir, { recursive: true, force: true });
      }
    }
  );

  test("preserves an existing ordinary target when the atomic commit rename fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-failure-"));
    const output = join(dir, "settings.json");
    await writeFile(output, "existing settings\n", "utf8");
    const commitError = Object.assign(new Error("injected ordinary atomic commit failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockRejectedValueOnce(commitError);

    await expect(atomicWriteFile(output, "replacement settings\n"))
      .rejects
      .toThrow("injected ordinary atomic commit failure");

    expect(await readFile(output, "utf8")).toBe("existing settings\n");
    expect((await readdir(dir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("reports commit and temp cleanup errors while retaining the residual temp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-files-cleanup-failure-"));
    const output = join(dir, "settings.json");
    await writeFile(output, "existing settings\n", "utf8");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected ordinary atomic commit failure"), {
      code: "EACCES"
    });
    const cleanupError = Object.assign(new Error("injected atomic temp cleanup failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockRejectedValueOnce(commitError);
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (String(path).endsWith(".tmp")) throw cleanupError;
      await actualFs.rm(path, options);
    });

    let caught: unknown;
    try {
      await atomicWriteFile(output, "replacement settings\n");
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(rm).mockImplementation(actualFs.rm);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const messages = (caught as AggregateError).errors.map(String).join("\n");
      expect(messages).toContain("injected ordinary atomic commit failure");
      expect(messages).toContain("injected atomic temp cleanup failure");
      expect(await readFile(output, "utf8")).toBe("existing settings\n");
      const tempFiles = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
      expect(tempFiles).toHaveLength(1);
      expect(await readFile(join(dir, tempFiles[0]!), "utf8")).toBe("replacement settings\n");
    } finally {
      await actualFs.rm(dir, { recursive: true, force: true });
    }
  });

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

async function captureDistinctWriterFailure(
  failures: Array<{ writeError?: Error; closeError?: Error }>
): Promise<unknown> {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const inputHandle = {
    stat: async () => ({ dev: 1, ino: 1 })
  } as unknown as FileHandle;
  const outputHandles = failures.map((failure, index) => ({
    stat: async () => ({ dev: 1, ino: index + 2 }),
    truncate: async () => undefined,
    writeFile: async () => {
      if (failure.writeError) throw failure.writeError;
    },
    close: async () => {
      if (failure.closeError) throw failure.closeError;
    }
  } as unknown as FileHandle));

  for (const handle of outputHandles) {
    vi.mocked(open).mockResolvedValueOnce(handle);
  }

  let caught: unknown;
  try {
    await writeFilesDistinctFromInput(
      inputHandle,
      failures.map((_, index) => ({ file: `output-${index}.txt`, data: `output ${index}\n` }))
    );
  } catch (error) {
    caught = error;
  } finally {
    vi.mocked(open).mockImplementation(actualFs.open);
  }
  return caught;
}
