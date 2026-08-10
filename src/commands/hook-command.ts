import { posix, win32 } from "node:path";
import { TRIMCTX_MANAGED_HOOK_FLAG, type HookCommands } from "./hook-settings.js";

export function createHookCommands(
  packageRoot: string,
  platform: NodeJS.Platform = process.platform,
  nodePath = process.execPath
): HookCommands {
  const pathApi = platform === "win32" ? win32 : posix;
  const cliPath = pathApi.join(packageRoot, "dist", "cli.js");
  if (!pathApi.isAbsolute(nodePath) || !pathApi.isAbsolute(cliPath)) {
    throw new Error("Claude hook command paths must be absolute");
  }

  const quote = platform === "win32" ? quoteWindowsArgument : quotePosixArgument;
  const stop = `${quote(nodePath)} ${quote(cliPath)} hook ${TRIMCTX_MANAGED_HOOK_FLAG}`;
  return {
    sessionStart: `${stop} --session-start`,
    stop
  };
}

function quotePosixArgument(value: string): string {
  assertNoControlCharacters(value);
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quoteWindowsArgument(value: string): string {
  assertNoControlCharacters(value);
  if (/["%!]/.test(value)) {
    throw new Error("Cannot safely quote Claude hook command path");
  }
  return `"${value}"`;
}

function assertNoControlCharacters(value: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Cannot safely quote Claude hook command path");
  }
}
