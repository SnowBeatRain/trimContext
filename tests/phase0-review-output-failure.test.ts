import { access, lstat, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { writePhase0ReviewArtifacts } from "../scripts/phase0-review-output.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    open: vi.fn(actual.open),
    rename: vi.fn(actual.rename),
    rm: vi.fn(actual.rm)
  };
});

describe("Phase 0 review artifact transaction failures", () => {
  test("restores both existing artifacts when the Markdown commit fails", async () => {
    const fixture = await reviewOutputFixture({ jsonExists: true, markdownExists: true });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected markdown commit failure"), { code: "EACCES" });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === fixture.markdownTarget) {
        throw commitError;
      }
      await actualFs.rename(from, to);
    });

    let caught: unknown;
    try {
      await writePhase0ReviewArtifacts(fixture.root, "new-json\n", "new-md\n");
    } catch (error) {
      caught = error;
    } finally {
      restoreFsMocks(actualFs);
    }

    try {
      expect(caught).toBe(commitError);
      expect(await readFile(fixture.jsonTarget, "utf8")).toBe("old-json\n");
      expect(await readFile(fixture.markdownTarget, "utf8")).toBe("old-md\n");
      expect(await transactionArtifacts(fixture.root)).toEqual([]);
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("removes a newly created JSON artifact when the Markdown commit fails", async () => {
    const fixture = await reviewOutputFixture({ jsonExists: false, markdownExists: true });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected markdown commit failure"), { code: "EACCES" });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith(".stage") && String(to) === fixture.markdownTarget) {
        throw commitError;
      }
      await actualFs.rename(from, to);
    });

    let caught: unknown;
    try {
      await writePhase0ReviewArtifacts(fixture.root, "new-json\n", "new-md\n");
    } catch (error) {
      caught = error;
    } finally {
      restoreFsMocks(actualFs);
    }

    try {
      expect(caught).toBe(commitError);
      expect(await fileExists(fixture.jsonTarget)).toBe(false);
      expect(await readFile(fixture.markdownTarget, "utf8")).toBe("old-md\n");
      expect(await transactionArtifacts(fixture.root)).toEqual([]);
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports commit and rollback failures while retaining the recoverable backup", async () => {
    const fixture = await reviewOutputFixture({ jsonExists: true, markdownExists: true });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const commitError = Object.assign(new Error("injected markdown commit failure"), { code: "EACCES" });
    const restoreError = Object.assign(new Error("injected json restore failure"), { code: "EACCES" });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      const source = String(from);
      const target = String(to);
      if (source.endsWith(".stage") && target === fixture.markdownTarget) throw commitError;
      if (source.endsWith(".bak") && target === fixture.jsonTarget) throw restoreError;
      await actualFs.rename(from, to);
    });

    let caught: unknown;
    try {
      await writePhase0ReviewArtifacts(fixture.root, "new-json\n", "new-md\n");
    } catch (error) {
      caught = error;
    } finally {
      restoreFsMocks(actualFs);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      expect(errorMessages(caught)).toContain("injected markdown commit failure");
      expect(errorMessages(caught)).toContain("injected json restore failure");
      expect(await fileExists(fixture.jsonTarget)).toBe(false);
      expect(await readFile(fixture.markdownTarget, "utf8")).toBe("old-md\n");
      const artifacts = await transactionArtifacts(fixture.root);
      const backup = artifacts.find((name) => name.startsWith(".phase0-review.json") && name.endsWith(".bak"));
      expect(backup).toBeDefined();
      expect(await readFile(join(fixture.root, backup!), "utf8")).toBe("old-json\n");
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports staging and cleanup failures while retaining the owned stage", async () => {
    const fixture = await reviewOutputFixture({ jsonExists: false, markdownExists: false });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const stageError = Object.assign(new Error("injected markdown stage failure"), { code: "EIO" });
    const cleanupError = Object.assign(new Error("injected json stage cleanup failure"), { code: "EACCES" });
    let openCalls = 0;
    vi.mocked(open).mockImplementation(async (path, flags, mode) => {
      openCalls += 1;
      if (openCalls === 2) throw stageError;
      return actualFs.open(path, flags, mode);
    });
    vi.mocked(rm).mockImplementation(async (path, options) => {
      if (String(path).endsWith(".stage")) throw cleanupError;
      await actualFs.rm(path, options);
    });

    let caught: unknown;
    try {
      await writePhase0ReviewArtifacts(fixture.root, "new-json\n", "new-md\n");
    } catch (error) {
      caught = error;
    } finally {
      restoreFsMocks(actualFs);
    }

    try {
      expect(caught).toBeInstanceOf(AggregateError);
      expect(errorMessages(caught)).toContain("injected markdown stage failure");
      expect(errorMessages(caught)).toContain("injected json stage cleanup failure");
      expect(await fileExists(fixture.jsonTarget)).toBe(false);
      expect(await fileExists(fixture.markdownTarget)).toBe(false);
      const artifacts = await transactionArtifacts(fixture.root);
      const stage = artifacts.find((name) => name.startsWith(".phase0-review.json") && name.endsWith(".stage"));
      expect(stage).toBeDefined();
      expect(await readFile(join(fixture.root, stage!), "utf8")).toBe("new-json\n");
    } finally {
      await actualFs.rm(fixture.root, { recursive: true, force: true });
    }
  });
});

interface ReviewOutputFixture {
  root: string;
  jsonTarget: string;
  markdownTarget: string;
}

async function reviewOutputFixture(options: {
  jsonExists: boolean;
  markdownExists: boolean;
}): Promise<ReviewOutputFixture> {
  const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-review-output-"));
  const jsonTarget = join(root, "phase0-review.json");
  const markdownTarget = join(root, "phase0-review.md");
  if (options.jsonExists) await writeFile(jsonTarget, "old-json\n", "utf8");
  if (options.markdownExists) await writeFile(markdownTarget, "old-md\n", "utf8");
  return { root, jsonTarget, markdownTarget };
}

function restoreFsMocks(actualFs: typeof import("node:fs/promises")): void {
  vi.mocked(lstat).mockImplementation(actualFs.lstat);
  vi.mocked(open).mockImplementation(actualFs.open);
  vi.mocked(rename).mockImplementation(actualFs.rename);
  vi.mocked(rm).mockImplementation(actualFs.rm);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function transactionArtifacts(root: string): Promise<string[]> {
  return (await readdir(root))
    .filter((name) => name.includes(".trimctx-") && (name.endsWith(".stage") || name.endsWith(".bak")))
    .sort();
}

function errorMessages(error: unknown): string {
  return error instanceof AggregateError
    ? error.errors.map((component) => errorMessages(component)).join("\n")
    : String(error);
}
