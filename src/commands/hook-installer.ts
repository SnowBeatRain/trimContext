import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFileIfUnchanged } from "../platform/files.js";
import {
  planHookSettings,
  plannedHookSettings,
  type HookCommands
} from "./hook-settings.js";

export interface InstallHooksOptions {
  commands: HookCommands;
  force?: boolean;
  dryRun?: boolean;
}

export async function installHooks(
  settingsPath: string,
  options: InstallHooksOptions
): Promise<string[]> {
  const snapshot = await readHookSettings(settingsPath);
  const plan = planHookSettings(snapshot.settings, options.commands, { force: options.force });

  if (plan.status === "already_installed") {
    return [`experimental Claude hooks already installed in ${settingsPath}`];
  }
  if (options.dryRun) {
    return [
      `dry-run: would write experimental Claude hooks to ${settingsPath}`,
      JSON.stringify(plannedHookSettings(options.commands), null, 2)
    ];
  }

  const output = `${JSON.stringify(plan.settings, null, 2)}\n`;
  await mkdir(dirname(settingsPath), { recursive: true });
  await atomicWriteFileIfUnchanged(
    settingsPath,
    output,
    snapshot.bytes,
    "Claude settings changed while hooks were being prepared"
  );
  return [`installed experimental Claude hooks in ${settingsPath}`];
}

interface HookSettingsSnapshot {
  settings: unknown;
  bytes: Buffer | undefined;
}

async function readHookSettings(settingsPath: string): Promise<HookSettingsSnapshot> {
  let bytes: Buffer;
  try {
    bytes = await readFile(settingsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { settings: {}, bytes: undefined };
    }
    throw new Error(`Failed to read Claude settings: ${settingsPath}`, { cause: error });
  }

  try {
    return { settings: JSON.parse(bytes.toString("utf8")) as unknown, bytes };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Claude settings JSON is invalid: ${settingsPath}`, { cause: error });
    }
    throw error;
  }
}
