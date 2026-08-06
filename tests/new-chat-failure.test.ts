import { Command } from "commander";
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { registerNewChatCommand } from "../src/commands/new-chat.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm)
  };
});

describe("new-chat package failure handling", () => {
  test("removes the owned package when a later output open fails", async () => {
    const fixture = await newChatFixture("write");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const siblingPackage = join(fixture.outputRoot, "existing-package");
    await actualFs.mkdir(siblingPackage, { recursive: true });
    await actualFs.writeFile(join(siblingPackage, "owner.txt"), "keep", "utf8");
    const writeError = Object.assign(new Error("injected next-context open failure"), {
      code: "EIO"
    });
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      if (String(path).endsWith("next-context.md")) throw writeError;
      return await actualFs.open(path, flags, mode);
    });

    try {
      await expect(runNewChat(fixture.input, fixture.outputRoot)).rejects.toBe(writeError);

      expect(await readdir(fixture.outputRoot)).toEqual(["existing-package"]);
      expect(await readFile(join(siblingPackage, "owner.txt"), "utf8")).toBe("keep");
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("does not clean up a conflicting package directory it did not create", async () => {
    const fixture = await newChatFixture("conflict");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const conflictError = Object.assign(new Error("injected package ownership conflict"), {
      code: "EEXIST"
    });
    vi.mocked(rm).mockClear().mockImplementation(actualFs.rm);
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      const target = String(path);
      if (dirname(target) === fixture.outputRoot && basename(target).startsWith("ctx_")) {
        await actualFs.mkdir(target);
        await actualFs.writeFile(join(target, "owner.txt"), "other-owner", "utf8");
        throw conflictError;
      }
      await actualFs.mkdir(path, options);
    });

    try {
      await expect(runNewChat(fixture.input, fixture.outputRoot))
        .rejects.toThrow("handoff package already exists");

      expect(rm).not.toHaveBeenCalled();
      const packages = await readdir(fixture.outputRoot);
      expect(packages).toHaveLength(1);
      expect(await readFile(join(fixture.outputRoot, packages[0]!, "owner.txt"), "utf8"))
        .toBe("other-owner");
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      vi.mocked(mkdir).mockImplementation(actualFs.mkdir);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports output and cleanup errors while retaining the residual package", async () => {
    const fixture = await newChatFixture("cleanup");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const writeError = Object.assign(new Error("injected next-context open failure"), {
      code: "EIO"
    });
    const cleanupError = Object.assign(new Error("injected package cleanup failure"), {
      code: "EACCES"
    });
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      if (String(path).endsWith("next-context.md")) throw writeError;
      return await actualFs.open(path, flags, mode);
    });
    vi.mocked(rm).mockImplementation(async (path, options) => {
      const target = String(path);
      if (dirname(target) === fixture.outputRoot && basename(target).startsWith("ctx_")) {
        throw cleanupError;
      }
      await actualFs.rm(path, options);
    });

    let caught: unknown;
    try {
      await runNewChat(fixture.input, fixture.outputRoot);
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      vi.mocked(rm).mockImplementation(actualFs.rm);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const messages = (caught as AggregateError).errors.map(String).join("\n");
      expect(messages).toContain("injected next-context open failure");
      expect(messages).toContain("injected package cleanup failure");
      expect((await readdir(fixture.outputRoot)).some((name) => name.startsWith("ctx_"))).toBe(true);
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function runNewChat(input: string, outputRoot: string): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerNewChatCommand(program, { packageVersion: "test-version" });
  await program.parseAsync([
    "node",
    "trimctx",
    "new-chat",
    input,
    "--out",
    outputRoot
  ]);
}

async function newChatFixture(name: string): Promise<{
  root: string;
  input: string;
  outputRoot: string;
  originalInput: string;
}> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-new-chat-failure-${name}-`));
  const input = join(root, "session.jsonl");
  const outputRoot = join(root, "handoffs");
  const originalInput = [
    '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
    '{"type":"user","uuid":"user-1","message":{"role":"user","content":"Prepare the next chat"}}',
    '{"type":"assistant","uuid":"assistant-1","message":{"role":"assistant","content":"Current work is ready to continue"}}'
  ].join("\n") + "\n";
  await mkdir(root, { recursive: true });
  await writeFile(input, originalInput, "utf8");
  return { root, input, outputRoot, originalInput };
}
