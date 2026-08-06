import { mkdir, mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  findLatestJsonlUnder,
  listSessions
} from "../src/sessions/catalog.js";
import { resolveCurrentSessionFile } from "../src/sessions/binding.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn(actual.readdir),
    stat: vi.fn(actual.stat)
  };
});

afterEach(async () => {
  const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(readdir).mockImplementation(actualFs.readdir);
  vi.mocked(stat).mockImplementation(actualFs.stat);
});

describe("session catalog failure handling", () => {
  test.each([
    {
      name: "session listing",
      run: (root: string) => listSessions("claude", root)
    },
    {
      name: "latest JSONL compatibility scan",
      run: (root: string) => findLatestJsonlUnder(root)
    }
  ])("propagates root read errors from $name", async ({ run }) => {
    const rootError = Object.assign(new Error("injected session root read failure"), {
      code: "EACCES"
    });
    vi.mocked(readdir).mockRejectedValueOnce(rootError);

    await expect(run("inaccessible-session-home")).rejects.toBe(rootError);
  });

  test("propagates candidate inspection errors", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-session-stat-failure-"));
    const sessionDir = join(home, ".claude", "projects", "project-a");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "session.jsonl"), "{}\n", "utf8");
    const statError = Object.assign(new Error("injected session candidate inspection failure"), {
      code: "EIO"
    });
    vi.mocked(stat).mockRejectedValueOnce(statError);

    await expect(listSessions("claude", home)).rejects.toBe(statError);
  });

  test("skips a JSONL that disappears during the compatibility scan", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-session-rotated-file-"));
    await writeFile(join(root, "rotated.jsonl"), "{}\n", "utf8");
    const missingError = Object.assign(new Error("injected rotated session"), {
      code: "ENOENT"
    });
    vi.mocked(stat).mockRejectedValueOnce(missingError);

    await expect(findLatestJsonlUnder(root)).resolves.toBeUndefined();
  });

  test("preserves catalog failures through current-session fallback", async () => {
    const rootError = Object.assign(new Error("injected current-session catalog failure"), {
      code: "EACCES"
    });
    vi.mocked(readdir).mockRejectedValueOnce(rootError);

    await expect(resolveCurrentSessionFile("claude", {
      env: {} as NodeJS.ProcessEnv,
      home: "inaccessible-session-home"
    })).rejects.toBe(rootError);
  });

  test("keeps missing session roots as an empty catalog", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-session-missing-roots-"));

    await expect(listSessions("auto", home)).resolves.toEqual([]);
  });
});
