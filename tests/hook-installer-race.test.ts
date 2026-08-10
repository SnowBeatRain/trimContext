import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { HookCommands } from "../src/commands/hook-settings.js";

const concurrentSettings = '{"external":"concurrent-write"}\n';

vi.mock("../src/platform/files.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/platform/files.js")>();
  return {
    ...actual,
    atomicWriteFileIfUnchanged: vi.fn(async (...args: Parameters<typeof actual.atomicWriteFileIfUnchanged>) => {
      await writeFile(args[0], concurrentSettings, "utf8");
      return await actual.atomicWriteFileIfUnchanged(...args);
    })
  };
});

const commands: HookCommands = {
  sessionStart: "'/absolute/node' '/absolute/dist/cli.js' hook --session-start",
  stop: "'/absolute/node' '/absolute/dist/cli.js' hook"
};

describe("Claude hook settings concurrent persistence", () => {
  test("preserves settings changed after the installer read", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-hook-installer-race-"));
    const settingsPath = join(root, ".claude", "settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, '{"existing":true}\n', "utf8");
    const { installHooks } = await import("../src/commands/hook-installer.js");

    await expect(installHooks(settingsPath, { commands })).rejects.toThrow(
      "Claude settings changed while hooks were being prepared"
    );
    expect(await readFile(settingsPath, "utf8")).toBe(concurrentSettings);
  });
});
