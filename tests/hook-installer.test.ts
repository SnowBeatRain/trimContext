import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { installHooks } from "../src/commands/hook-installer.js";
import { plannedHookSettings } from "../src/commands/hook-settings.js";

describe("Claude hook settings installation", () => {
  test("creates missing settings with both hooks atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-hook-installer-"));
    const settingsDir = join(root, ".claude");
    const settingsPath = join(settingsDir, "settings.json");

    await expect(installHooks(settingsPath)).resolves.toEqual([
      `installed experimental Claude hooks in ${settingsPath}`
    ]);

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(plannedHookSettings());
    expect((await readdir(settingsDir)).filter((name) => name.includes(".trimctx-"))).toEqual([]);
  });

  test("preserves invalid JSON", async () => {
    const settingsPath = await writeSettings("{broken");

    await expect(installHooks(settingsPath)).rejects.toThrow(
      `Claude settings JSON is invalid: ${settingsPath}`
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe("{broken");
  });

  test("dry-run does not reveal or modify existing settings", async () => {
    const content = JSON.stringify({ env: { TOKEN: "secret" }, permissions: { allow: ["Bash"] } });
    const settingsPath = await writeSettings(content);

    const lines = await installHooks(settingsPath, { dryRun: true });

    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).not.toContain("permissions");
    expect(lines.join("\n")).toContain("trimctx hook --session-start");
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(content);
  });

  test("does not treat non-ENOENT read failures as missing settings", async () => {
    const settingsPath = await mkdtemp(join(tmpdir(), "trimctx-hook-settings-directory-"));

    await expect(installHooks(settingsPath)).rejects.toThrow(
      `Failed to read Claude settings: ${settingsPath}`
    );
  });
});

async function writeSettings(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trimctx-hook-installer-"));
  const settingsDir = join(root, ".claude");
  const settingsPath = join(settingsDir, "settings.json");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsPath, content, "utf8");
  return settingsPath;
}
