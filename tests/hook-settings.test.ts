import { describe, expect, test } from "vitest";
import {
  planHookSettings,
  plannedHookSettings,
  type HookCommands
} from "../src/commands/hook-settings.js";

const commands: HookCommands = {
  sessionStart: "'/absolute/node' '/absolute/dist/cli.js' hook --trimctx-managed-hook --session-start",
  stop: "'/absolute/node' '/absolute/dist/cli.js' hook --trimctx-managed-hook"
};

describe("Claude hook settings planning", () => {
  test("adds missing hooks while preserving unknown settings", () => {
    const settings = {
      permissions: { allow: ["Bash"] },
      hooks: {
        Custom: [{ matcher: "custom", hooks: [{ type: "command", command: "custom" }] }]
      }
    };

    expect(planHookSettings(settings, commands)).toEqual({
      status: "write",
      settings: {
        permissions: settings.permissions,
        hooks: {
          Custom: settings.hooks.Custom,
          SessionStart: [{
            hooks: [{ type: "command", command: commands.sessionStart }]
          }],
          Stop: [{ hooks: [{ type: "command", command: commands.stop }] }]
        }
      }
    });
  });

  test("reports already-installed settings without producing a write plan", () => {
    expect(planHookSettings(plannedHookSettings(commands), commands)).toEqual({ status: "already_installed" });
  });

  test("force removes only matching entries from mixed groups", () => {
    expect(planHookSettings({
      hooks: {
        SessionStart: [{
          matcher: "all",
          hooks: [
            { type: "command", command: commands.sessionStart },
            { type: "command", command: "user session", timeout: 30 }
          ]
        }],
        Stop: [{ hooks: [
          { type: "command", command: commands.stop },
          { type: "command", command: "user stop" }
        ] }]
      }
    }, commands, { force: true })).toEqual({
      status: "write",
      settings: {
        hooks: {
          SessionStart: [
            {
              matcher: "all",
              hooks: [{ type: "command", command: "user session", timeout: 30 }]
            },
            { hooks: [{ type: "command", command: commands.sessionStart }] }
          ],
          Stop: [
            { hooks: [{ type: "command", command: "user stop" }] },
            { hooks: [{ type: "command", command: commands.stop }] }
          ]
        }
      }
    });
  });

  test("force migrates exact legacy trimctx commands without removing user hooks", () => {
    const plan = planHookSettings({
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "trimctx hook --session-start" },
          { type: "command", command: "user session hook" }
        ] }],
        Stop: [{ hooks: [
          { type: "command", command: "trimctx hook" },
          { type: "command", command: "user stop hook" }
        ] }]
      }
    }, commands, { force: true });

    expect(plan).toMatchObject({ status: "write" });
    if (plan.status !== "write") throw new Error("expected hook settings write plan");
    const serialized = JSON.stringify(plan.settings);
    expect(serialized).not.toContain('"command":"trimctx hook"');
    expect(serialized).not.toContain('"command":"trimctx hook --session-start"');
    expect(serialized).toContain("user session hook");
    expect(serialized).toContain("user stop hook");
    expect(serialized).toContain(commands.sessionStart);
    expect(serialized).toContain(commands.stop);
  });

  test("replaces stale managed absolute commands while preserving user hooks", () => {
    const previousCommands: HookCommands = {
      sessionStart: "'/old/node' '/old/trimctx/dist/cli.js' hook --trimctx-managed-hook --session-start",
      stop: "'/old/node' '/old/trimctx/dist/cli.js' hook --trimctx-managed-hook"
    };
    const plan = planHookSettings({
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: previousCommands.sessionStart },
          { type: "command", command: "user session hook" }
        ] }],
        Stop: [{ hooks: [
          { type: "command", command: previousCommands.stop },
          { type: "command", command: "user stop hook" }
        ] }]
      }
    }, commands);

    expect(plan).toMatchObject({ status: "write" });
    if (plan.status !== "write") throw new Error("expected hook settings write plan");
    const serialized = JSON.stringify(plan.settings);
    expect(serialized).not.toContain(previousCommands.sessionStart);
    expect(serialized).not.toContain(previousCommands.stop);
    expect(serialized).toContain("user session hook");
    expect(serialized).toContain("user stop hook");
    expect(serialized).toContain(commands.sessionStart);
    expect(serialized).toContain(commands.stop);
  });

  test("returns a privacy-safe standalone preview", () => {
    expect(plannedHookSettings(commands)).toEqual({
      hooks: {
        SessionStart: [{
          hooks: [{ type: "command", command: commands.sessionStart }]
        }],
        Stop: [{ hooks: [{ type: "command", command: commands.stop }] }]
      }
    });
  });

  test.each([
    { input: null, error: "Claude settings must be an object" },
    { input: [], error: "Claude settings must be an object" },
    { input: { hooks: "invalid" }, error: "Claude settings hooks must be an object" },
    {
      input: { hooks: { SessionStart: {} } },
      error: "Claude settings hooks.SessionStart must be an array"
    },
    {
      input: { hooks: { SessionStart: [null] } },
      error: "Claude settings hooks.SessionStart[0] must be an object"
    },
    {
      input: { hooks: { SessionStart: [{ hooks: {} }] } },
      error: "Claude settings hooks.SessionStart[0].hooks must be an array"
    },
    {
      input: { hooks: { SessionStart: [{ hooks: [null] }] } },
      error: "Claude settings hooks.SessionStart[0].hooks[0] must be an object"
    }
  ])("rejects invalid required containers: $error", ({ input, error }) => {
    expect(() => planHookSettings(input, commands)).toThrow(error);
  });
});
