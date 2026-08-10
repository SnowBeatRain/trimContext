import { describe, expect, test } from "vitest";
import { createHookCommands } from "../src/commands/hook-command.js";
import { createHookCommand } from "../src/commands/hook.js";

describe("Claude hook command construction", () => {
  test("quotes absolute POSIX Node and CLI paths", () => {
    expect(createHookCommands("/opt/trim ctx", "linux", "/usr/local/bin/node")).toEqual({
      sessionStart: "'/usr/local/bin/node' '/opt/trim ctx/dist/cli.js' hook --trimctx-managed-hook --session-start",
      stop: "'/usr/local/bin/node' '/opt/trim ctx/dist/cli.js' hook --trimctx-managed-hook"
    });
    expect(createHookCommands("/tmp/it's trimctx", "linux", "/usr/bin/node").stop).toBe(
      "'/usr/bin/node' '/tmp/it'\\''s trimctx/dist/cli.js' hook --trimctx-managed-hook"
    );
  });

  test("quotes absolute Windows Node and CLI paths", () => {
    expect(createHookCommands(
      "C:\\Program Files\\trimctx",
      "win32",
      "C:\\Program Files\\nodejs\\node.exe"
    )).toEqual({
      sessionStart: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Program Files\\trimctx\\dist\\cli.js\" hook --trimctx-managed-hook --session-start",
      stop: "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\Program Files\\trimctx\\dist\\cli.js\" hook --trimctx-managed-hook"
    });
  });

  test("keeps the generated ownership flag out of public hook help", () => {
    const command = createHookCommand();
    const managedOption = command.options.find(option => option.long === "--trimctx-managed-hook");

    expect(managedOption?.hidden).toBe(true);
    expect(command.helpInformation()).not.toContain("--trimctx-managed-hook");
  });

  test.each([
    { platform: "linux" as const, packageRoot: "/opt/trimctx", nodePath: "/usr/bin/no\nde" },
    { platform: "win32" as const, packageRoot: "C:\\trimctx", nodePath: "C:\\unsafe%PATH%\\node.exe" },
    { platform: "win32" as const, packageRoot: "C:\\trimctx", nodePath: "C:\\unsafe!path\\node.exe" },
    { platform: "win32" as const, packageRoot: "C:\\trimctx", nodePath: "C:\\unsafe\"path\\node.exe" }
  ])("rejects a path that cannot be safely quoted on $platform", ({ platform, packageRoot, nodePath }) => {
    expect(() => createHookCommands(packageRoot, platform, nodePath)).toThrow(
      "Cannot safely quote Claude hook command path"
    );
  });

  test("rejects relative Node or package paths", () => {
    expect(() => createHookCommands("relative-package", "linux", "/usr/bin/node")).toThrow(
      "Claude hook command paths must be absolute"
    );
    expect(() => createHookCommands("/opt/trimctx", "linux", "node")).toThrow(
      "Claude hook command paths must be absolute"
    );
  });
});
