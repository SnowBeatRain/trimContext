import { Command } from "commander";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { registerNewChatCommand } from "../src/commands/new-chat.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    mkdir: vi.fn(actual.mkdir),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm)
  };
});

const PACKAGE_FILES = [
  "README.md",
  "handoff.md",
  "manifest.json",
  "next-context.md",
  "report.json"
];

describe("new-chat package failure handling", () => {
  test("keeps the final uid directory private until every staged output is ready", async () => {
    const fixture = await newChatFixture("visibility");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const observedFinalDirectories: string[][] = [];
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      if (String(path).endsWith("handoff.md")) {
        const names = await actualFs.readdir(fixture.outputRoot);
        observedFinalDirectories.push(names.filter(name => name.startsWith("ctx_")));
      }
      return await actualFs.open(path, flags as "r", mode);
    });

    try {
      await runNewChat(fixture.input, fixture.outputRoot);

      expect(observedFinalDirectories).toEqual([[]]);
      const names = await readdir(fixture.outputRoot);
      expect(names.filter(name => name.startsWith("ctx_"))).toHaveLength(1);
      expect(names.filter(name => name.includes(".trimctx-") || name.endsWith(".tmp"))).toEqual([]);
      expect(await readdir(join(fixture.outputRoot, names[0]!))).toEqual(PACKAGE_FILES);
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test.runIf(process.platform !== "win32")("publishes a private directory containing private files", async () => {
    const fixture = await newChatFixture("permissions");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

    try {
      await runNewChat(fixture.input, fixture.outputRoot);

      const packageName = (await readdir(fixture.outputRoot)).find(name => name.startsWith("ctx_"));
      expect(packageName).toBeDefined();
      const packageDir = join(fixture.outputRoot, packageName!);
      expect((await stat(packageDir)).mode & 0o777).toBe(0o700);
      for (const name of PACKAGE_FILES) {
        expect((await stat(join(packageDir, name))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("fails closed before writing when staging identity is unreliable", async () => {
    const fixture = await newChatFixture("unreliable-staging");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(lstat).mockImplementation(async (path, options) => {
      if (basename(String(path)).includes(".trimctx-")) {
        const stats = await actualFs.lstat(path, { bigint: true });
        Object.defineProperty(stats, "ino", { value: 0n });
        return stats as never;
      }
      return await actualFs.lstat(path, options as never);
    });

    try {
      await expect(runNewChat(fixture.input, fixture.outputRoot))
        .rejects
        .toThrow("reliable staging directory identity");
      const names = await readdir(fixture.outputRoot);
      expect(names.filter(name => name.startsWith("ctx_"))).toEqual([]);
      expect(names.filter(name => name.includes(".trimctx-"))).toHaveLength(1);
      expect(await readdir(join(fixture.outputRoot, names[0]!))).toEqual([]);
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      vi.mocked(lstat).mockImplementation(actualFs.lstat);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("removes owned staging when a later output open fails without exposing a final package", async () => {
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

  test("rejects an input changed during output preparation and leaves no package", async () => {
    const fixture = await newChatFixture("input-change");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode);
      if (String(path).endsWith("README.md")) {
        await actualFs.writeFile(fixture.input, `${fixture.originalInput}changed\n`, "utf8");
      }
      return handle;
    });

    try {
      await expect(runNewChat(fixture.input, fixture.outputRoot))
        .rejects
        .toThrow("Input file changed while output was being prepared");
      expect(await readdir(fixture.outputRoot)).toEqual([]);
      expect(await readFile(fixture.input, "utf8")).toBe(`${fixture.originalInput}changed\n`);
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects a staging path replaced before publish", async () => {
    const fixture = await newChatFixture("publish-identity");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let stagingReads = 0;
    let replacementDirectory: string | undefined;
    vi.mocked(lstat).mockImplementation(async (path, options) => {
      const target = String(path);
      if (basename(target).includes(".trimctx-")) {
        stagingReads += 1;
        if (stagingReads === 2) {
          const movedOwnedDirectory = join(fixture.outputRoot, "moved-before-publish");
          await actualFs.rename(target, movedOwnedDirectory);
          await actualFs.mkdir(target, { mode: 0o700 });
          await actualFs.writeFile(join(target, "owner.txt"), "replacement-owner", "utf8");
          replacementDirectory = target;
        }
      }
      return await actualFs.lstat(path, options as never);
    });

    let caught: unknown;
    try {
      await runNewChat(fixture.input, fixture.outputRoot);
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(lstat).mockImplementation(actualFs.lstat);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const messages = (caught as AggregateError).errors.map(String).join("\n");
      expect(messages).toContain("staging directory identity changed");
      expect(replacementDirectory).toBeDefined();
      expect(await readFile(join(replacementDirectory!, "owner.txt"), "utf8"))
        .toBe("replacement-owner");
      expect((await readdir(fixture.outputRoot)).filter(name => name.startsWith("ctx_"))).toEqual([]);
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("preserves a non-empty final package created concurrently instead of overwriting it", async () => {
    const fixture = await newChatFixture("final-conflict");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementation(async (oldPath, newPath) => {
      const source = String(oldPath);
      const target = String(newPath);
      if (dirname(target) === fixture.outputRoot && basename(target).startsWith("ctx_") && source !== target) {
        await actualFs.mkdir(target);
        await actualFs.writeFile(join(target, "owner.txt"), "other-owner", "utf8");
      }
      await actualFs.rename(oldPath, newPath);
    });

    try {
      await expect(runNewChat(fixture.input, fixture.outputRoot))
        .rejects
        .toThrow("handoff package already exists");

      const packages = (await readdir(fixture.outputRoot)).filter(name => name.startsWith("ctx_"));
      expect(packages).toHaveLength(1);
      expect(await readFile(join(fixture.outputRoot, packages[0]!, "owner.txt"), "utf8"))
        .toBe("other-owner");
      expect((await readdir(fixture.outputRoot)).filter(name => name.includes(".trimctx-"))).toEqual([]);
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      vi.mocked(rename).mockImplementation(actualFs.rename);
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("refuses recursive cleanup after the staging path is replaced", async () => {
    const fixture = await newChatFixture("cleanup-identity");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const writeError = Object.assign(new Error("injected output open failure after replacement"), {
      code: "EIO"
    });
    let replacementDirectory: string | undefined;
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      const target = String(path);
      if (target.endsWith("next-context.md")) {
        const stagingDir = dirname(target);
        const movedOwnedDirectory = join(fixture.outputRoot, "moved-owned-staging");
        await actualFs.rename(stagingDir, movedOwnedDirectory);
        await actualFs.mkdir(stagingDir, { mode: 0o700 });
        await actualFs.writeFile(join(stagingDir, "owner.txt"), "replacement-owner", "utf8");
        replacementDirectory = stagingDir;
        throw writeError;
      }
      return await actualFs.open(path, flags, mode);
    });

    let caught: unknown;
    try {
      await runNewChat(fixture.input, fixture.outputRoot);
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(open).mockImplementation(actualFs.open);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      const messages = (caught as AggregateError).errors.map(String).join("\n");
      expect(messages).toContain("injected output open failure after replacement");
      expect(messages).toContain("staging directory identity changed");
      expect(replacementDirectory).toBeDefined();
      expect(await readFile(join(replacementDirectory!, "owner.txt"), "utf8"))
        .toBe("replacement-owner");
      expect(await readFile(fixture.input, "utf8")).toBe(fixture.originalInput);
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports output and cleanup errors while retaining the residual staging directory", async () => {
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
      if (dirname(target) === fixture.outputRoot && basename(target).includes(".trimctx-")) {
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
      expect((await readdir(fixture.outputRoot)).some(name => name.includes(".trimctx-"))).toBe(true);
      expect((await readdir(fixture.outputRoot)).some(name => name.startsWith("ctx_"))).toBe(false);
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
