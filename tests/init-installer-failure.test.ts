import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { installInitAssets } from "../src/commands/init-installer.js";
import type { InitAsset } from "../src/commands/init-plan.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    access: vi.fn(actual.access),
    cp: vi.fn(actual.cp),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm)
  };
});

describe("init asset transaction failures", () => {
  test("fails before staging when destination access cannot be classified as missing", async () => {
    const fixture = await installedAssetFixture("access", "claude");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const accessError = Object.assign(new Error("injected destination access failure"), {
      code: "EACCES"
    });
    vi.mocked(cp).mockClear().mockImplementation(actualFs.cp);
    vi.mocked(access).mockImplementation(async (path, mode) => {
      if (String(path) === fixture.asset.destination) {
        throw accessError;
      }
      await actualFs.access(path, mode);
    });

    let caught: unknown;
    try {
      await installInitAssets([fixture.asset], { force: true });
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(access).mockImplementation(actualFs.access);
    }

    expect(caught).toBe(accessError);
    expect(cp).not.toHaveBeenCalled();
    expect(await readTextOrMissing(fixture.oldFile)).toBe("old-access");
    expect(await transactionArtifacts(fixture.parent)).toEqual([]);
  });

  test("preserves all existing assets when the second staging copy fails", async () => {
    const first = await installedAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const copyError = Object.assign(new Error("injected second asset copy failure"), {
      code: "EIO"
    });
    vi.mocked(cp)
      .mockImplementationOnce(actualFs.cp)
      .mockRejectedValueOnce(copyError);

    await expect(installInitAssets([first.asset, second.asset], { force: true }))
      .rejects.toThrow("injected second asset copy failure");

    expect(await readTextOrMissing(first.oldFile)).toBe("old-first");
    expect(await readTextOrMissing(second.oldFile)).toBe("old-second");
    expect(await fileExists(first.currentFile)).toBe(false);
    expect(await fileExists(second.currentFile)).toBe(false);
    expect(await transactionArtifacts(first.parent)).toEqual([]);
    expect(await transactionArtifacts(second.parent)).toEqual([]);
  });

  test("restores all existing assets when the second staged commit fails", async () => {
    const first = await installedAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected second asset commit failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === second.asset.destination) {
        throw commitError;
      }
      await actualFs.rename(from, to);
    });

    try {
      await expect(installInitAssets([first.asset, second.asset], { force: true }))
        .rejects.toThrow("injected second asset commit failure");
    } finally {
      vi.mocked(rename).mockImplementation(actualFs.rename);
    }

    expect(await readTextOrMissing(first.oldFile)).toBe("old-first");
    expect(await readTextOrMissing(second.oldFile)).toBe("old-second");
    expect(await fileExists(first.currentFile)).toBe(false);
    expect(await fileExists(second.currentFile)).toBe(false);
    expect(await transactionArtifacts(first.parent)).toEqual([]);
    expect(await transactionArtifacts(second.parent)).toEqual([]);
  });

  test("reports commit and rollback errors while preserving the recoverable backup", async () => {
    const first = await installedAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected second asset commit failure"), {
      code: "EACCES"
    });
    const restoreError = Object.assign(new Error("injected first asset restore failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === second.asset.destination) {
        throw commitError;
      }
      if (String(from).endsWith(".bak") && String(to) === first.asset.destination) {
        throw restoreError;
      }
      await actualFs.rename(from, to);
    });

    let caught: unknown;
    try {
      await installInitAssets([first.asset, second.asset], { force: true });
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(rename).mockImplementation(actualFs.rename);
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const messages = (caught as AggregateError).errors.map(String).join("\n");
    expect(messages).toContain("injected second asset commit failure");
    expect(messages).toContain("injected first asset restore failure");
    expect(await readTextOrMissing(second.oldFile)).toBe("old-second");

    const firstArtifacts = await transactionArtifacts(first.parent);
    expect(firstArtifacts.filter((name) => name.endsWith(".stage"))).toEqual([]);
    const backupName = firstArtifacts.find((name) => name.endsWith(".bak"));
    expect(backupName).toBeDefined();
    expect(await readFile(join(first.parent, backupName!, "old.txt"), "utf8")).toBe("old-first");
  });

  test("reports current commit and restore errors while preserving the current backup", async () => {
    const first = await installedAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected second asset commit failure"), {
      code: "EACCES"
    });
    const restoreError = Object.assign(new Error("injected second asset restore failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === second.asset.destination) {
        throw commitError;
      }
      if (String(from).endsWith(".bak") && String(to) === second.asset.destination) {
        throw restoreError;
      }
      await actualFs.rename(from, to);
    });

    let caught: unknown;
    try {
      await installInitAssets([first.asset, second.asset], { force: true });
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(rename).mockImplementation(actualFs.rename);
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const messages = (caught as AggregateError).errors.map(String).join("\n");
    expect(messages).toContain("injected second asset commit failure");
    expect(messages).toContain("injected second asset restore failure");
    expect(await readTextOrMissing(first.oldFile)).toBe("old-first");
    expect(await transactionArtifacts(first.parent)).toEqual([]);

    const secondArtifacts = await transactionArtifacts(second.parent);
    const backupName = secondArtifacts.find((name) => name.endsWith(".bak"));
    expect(backupName).toBeDefined();
    expect(await readFile(join(second.parent, backupName!, "old.txt"), "utf8")).toBe("old-second");
  });

  test("removes a newly installed destination when a later commit fails", async () => {
    const first = await newAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected second asset commit failure"), {
      code: "EACCES"
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === second.asset.destination) {
        throw commitError;
      }
      await actualFs.rename(from, to);
    });

    try {
      await expect(installInitAssets([first.asset, second.asset], { force: true }))
        .rejects.toThrow("injected second asset commit failure");
    } finally {
      vi.mocked(rename).mockImplementation(actualFs.rename);
    }

    expect(await fileExists(first.asset.destination)).toBe(false);
    expect(await readTextOrMissing(second.oldFile)).toBe("old-second");
    expect(await transactionArtifacts(first.parent)).toEqual([]);
    expect(await transactionArtifacts(second.parent)).toEqual([]);
  });

  test("reports staging cleanup errors while retaining the residual stage", async () => {
    const first = await installedAssetFixture("first", "claude");
    const second = await installedAssetFixture("second", "codex");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const copyError = Object.assign(new Error("injected second asset copy failure"), {
      code: "EIO"
    });
    const cleanupError = Object.assign(new Error("injected first stage cleanup failure"), {
      code: "EACCES"
    });
    vi.mocked(cp)
      .mockImplementationOnce(actualFs.cp)
      .mockRejectedValueOnce(copyError);
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (dirname(String(path)) === first.parent && String(path).endsWith(".stage")) {
        throw cleanupError;
      }
      await actualFs.rm(path, options);
    });

    let caught: unknown;
    try {
      await installInitAssets([first.asset, second.asset], { force: true });
    } catch (error) {
      caught = error;
    } finally {
      vi.mocked(rm).mockImplementation(actualFs.rm);
    }

    expect(caught).toBeInstanceOf(AggregateError);
    const messages = (caught as AggregateError).errors.map(String).join("\n");
    expect(messages).toContain("injected second asset copy failure");
    expect(messages).toContain("injected first stage cleanup failure");

    const firstArtifacts = await transactionArtifacts(first.parent);
    const stageName = firstArtifacts.find((name) => name.endsWith(".stage"));
    expect(stageName).toBeDefined();
    expect(await readFile(join(first.parent, stageName!, "current.txt"), "utf8")).toBe("current-first");
  });
});

interface InstalledAssetFixture {
  asset: InitAsset;
  parent: string;
  oldFile: string;
  currentFile: string;
}

async function newAssetFixture(
  name: string,
  client: InitAsset["client"]
): Promise<{ asset: InitAsset; parent: string }> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-init-transaction-${name}-`));
  const source = join(root, "source", "trimctx");
  const destination = join(root, "installed", "trimctx");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "current.txt"), `current-${name}`, "utf8");
  return {
    asset: {
      client,
      source,
      destination,
      label: `${name} asset`
    },
    parent: dirname(destination)
  };
}

async function installedAssetFixture(
  name: string,
  client: InitAsset["client"]
): Promise<InstalledAssetFixture> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-init-transaction-${name}-`));
  const source = join(root, "source", "trimctx");
  const destination = join(root, "installed", "trimctx");
  const oldFile = join(destination, "old.txt");
  const currentFile = join(destination, "current.txt");
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(join(source, "current.txt"), `current-${name}`, "utf8");
  await writeFile(oldFile, `old-${name}`, "utf8");
  return {
    asset: {
      client,
      source,
      destination,
      label: `${name} asset`
    },
    parent: dirname(destination),
    oldFile,
    currentFile
  };
}

async function readTextOrMissing(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "<missing>";
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function transactionArtifacts(parent: string): Promise<string[]> {
  return (await readdir(parent))
    .filter((name) => name.includes(".trimctx-") && (name.endsWith(".stage") || name.endsWith(".bak")))
    .sort();
}
