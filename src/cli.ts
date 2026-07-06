#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { registerCommands } from "./commands/index.js";

const program = new Command();
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_VERSION = readPackageVersion();

program
  .name("trimctx")
  .description("Analyze and safely trim long AI conversation context.")
  .version(PACKAGE_VERSION);

registerCommands(program, { packageRoot: PACKAGE_ROOT, packageVersion: PACKAGE_VERSION });

function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
    const packageJson = JSON.parse(raw) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // Fall through to a visible fallback so --version still works in unusual dev layouts.
  }
  return "0.0.0-dev";
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`trimctx: ${message}
`);
  process.exitCode = 1;
});
