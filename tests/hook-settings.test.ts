import { describe, expect, test } from "vitest";
import {
  planHookSettings,
  plannedHookSettings
} from "../src/commands/hook-settings.js";

describe("Claude hook settings planning", () => {
  test("adds missing hooks while preserving unknown settings", () => {
    const settings = {
      permissions: { allow: ["Bash"] },
      hooks: {
        Custom: [{ matcher: "custom", hooks: [{ type: "command", command: "custom" }] }]
      }
    };

    expect(planHookSettings(settings)).toEqual({
      status: "write",
      settings: {
        permissions: settings.permissions,
        hooks: {
          Custom: settings.hooks.Custom,
          SessionStart: [{
            hooks: [{ type: "command", command: "trimctx hook --session-start" }]
          }],
          Stop: [{ hooks: [{ type: "command", command: "trimctx hook" }] }]
        }
      }
    });
  });

  test("reports already-installed settings without producing a write plan", () => {
    expect(planHookSettings(plannedHookSettings())).toEqual({ status: "already_installed" });
  });

  test("force removes only matching entries from mixed groups", () => {
    expect(planHookSettings({
      hooks: {
        SessionStart: [{
          matcher: "all",
          hooks: [
            { type: "command", command: "trimctx hook --session-start" },
            { type: "command", command: "user session", timeout: 30 }
          ]
        }],
        Stop: [{ hooks: [
          { type: "command", command: "trimctx hook" },
          { type: "command", command: "user stop" }
        ] }]
      }
    }, { force: true })).toEqual({
      status: "write",
      settings: {
        hooks: {
          SessionStart: [
            {
              matcher: "all",
              hooks: [{ type: "command", command: "user session", timeout: 30 }]
            },
            { hooks: [{ type: "command", command: "trimctx hook --session-start" }] }
          ],
          Stop: [
            { hooks: [{ type: "command", command: "user stop" }] },
            { hooks: [{ type: "command", command: "trimctx hook" }] }
          ]
        }
      }
    });
  });

  test("returns a privacy-safe standalone preview", () => {
    expect(plannedHookSettings()).toEqual({
      hooks: {
        SessionStart: [{
          hooks: [{ type: "command", command: "trimctx hook --session-start" }]
        }],
        Stop: [{ hooks: [{ type: "command", command: "trimctx hook" }] }]
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
    expect(() => planHookSettings(input)).toThrow(error);
  });
});
