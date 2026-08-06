import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile } from "../platform/files.js";
import {
  planHookSettings,
  plannedHookSettings
} from "./hook-settings.js";

export interface InstallHooksOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function installHooks(
  settingsPath: string,
  options: InstallHooksOptions = {}
): Promise<string[]> {
  const settings = await readHookSettings(settingsPath);
  const plan = planHookSettings(settings, { force: options.force });

  if (plan.status === "already_installed") {
    return [`experimental Claude hooks already installed in ${settingsPath}`];
  }
  if (options.dryRun) {
    return [
      `dry-run: would write experimental Claude hooks to ${settingsPath}`,
      JSON.stringify(plannedHookSettings(), null, 2)
    ];
  }

  const output = `${JSON.stringify(plan.settings, null, 2)}\n`;
  await mkdir(dirname(settingsPath), { recursive: true });
  await atomicWriteFile(settingsPath, output);
  return [`installed experimental Claude hooks in ${settingsPath}`];
}

async function readHookSettings(settingsPath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Failed to read Claude settings: ${settingsPath}`, { cause: error });
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Claude settings JSON is invalid: ${settingsPath}`, { cause: error });
    }
    throw error;
  }
}
