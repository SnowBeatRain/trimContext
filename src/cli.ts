#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerCommands } from "./commands/index.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = readPackageVersion(packageRoot);
const program = new Command();

program
  .name("trimctx")
  .description("Analyze and safely trim long AI conversation context.")
  .version(packageVersion);

registerCommands(program, { packageRoot, packageVersion });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trimctx: ${message}\n`);
  process.exitCode = 1;
});

function readPackageVersion(root: string): string {
  try {
    const raw = readFileSync(join(root, "package.json"), "utf8");
    const packageJson = JSON.parse(raw) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Keep --version usable in unusual development layouts.
  }
  return "0.0.0-dev";
}
