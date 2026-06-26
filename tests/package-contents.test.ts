import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const unsafeInstallPipePatterns = [
  /curl\s+[^\n|]*\|\s*(bash|sh)/i,
  /\birm\s+[^\n|]*\|\s*iex\b/i,
  /\biwr\s+[^\n|]*\|\s*iex\b/i
];

function npmCommandEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.npm_config_dry_run;
  delete env.npm_config_cache;
  delete env.NPM_CONFIG_CACHE;
  env.npm_config_cache = npmCacheDir();
  env.NPM_CONFIG_CACHE = npmCacheDir();
  return env;
}

function npmCacheDir(): string {
  return path.join(tmpdir(), "trimctx-npm-cache", String(process.pid));
}

async function listPackedFiles(): Promise<string[]> {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(npmBin, ["pack", "--dry-run", "--json", "--cache", npmCacheDir()], {
    cwd: process.cwd(),
    env: npmCommandEnv(),
    shell: process.platform === "win32"
  });
  const [pack] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;

  return pack.files.map((file) => file.path);
}

async function packTarball(destination: string): Promise<string> {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(npmBin, ["pack", "--pack-destination", destination, "--json", "--cache", npmCacheDir()], {
    cwd: process.cwd(),
    env: npmCommandEnv(),
    shell: process.platform === "win32"
  });
  const [pack] = JSON.parse(stdout) as Array<{ filename: string }>;

  return path.join(destination, pack.filename);
}

function installedTrimctxBinary(prefix: string): string {
  return process.platform === "win32"
    ? path.join(prefix, "trimctx.cmd")
    : path.join(prefix, "bin", "trimctx");
}

describe("package contents", () => {
  test("includes Claude plugin and Codex skill integration files", async () => {
    const files = await listPackedFiles();

    expect(files).toContain("install.sh");
    expect(files).toContain("install.ps1");
    expect(files).toContain("plugins/trimctx/.claude-plugin/plugin.json");
    expect(files).toContain("plugins/trimctx/.system");
    expect(files).toContain("plugins/trimctx/commands/trimctx.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/analyze.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/compress.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/handoff.md");
    expect(files).not.toContain("plugins/trimctx/commands/trimctx/resume.md");
    expect(files).toContain("codex/skills/trimctx/SKILL.md");
  }, 30_000);

  test("publishes only the bundled CLI, not the source or expanded module tree", async () => {
    const files = await listPackedFiles();

    expect(files).toContain("dist/cli.js");
    expect(files.some((file) => file.startsWith("src/"))).toBe(false);
    expect(files.some((file) => file.endsWith(".ts"))).toBe(false);
    expect(files.some((file) => file.endsWith(".d.ts"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/core/"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/adapters/"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/types/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/dev/"))).toBe(false);
    expect(files).not.toContain("CONTRIBUTING.md");
  }, 30_000);

  test("does not publish download-and-execute install pipe examples", async () => {
    const files = await listPackedFiles();
    const publicTextFiles = files.filter((file) => {
      const extension = path.extname(file).toLowerCase();
      return (
        [".md", ".txt", ".sh", ".ps1"].includes(extension) ||
        file === "plugins/trimctx/.system"
      );
    });

    const unsafeMatches: string[] = [];
    for (const file of publicTextFiles) {
      const content = await readFile(path.join(process.cwd(), file), "utf8");
      for (const pattern of unsafeInstallPipePatterns) {
        if (pattern.test(content)) {
          unsafeMatches.push(file);
          break;
        }
      }
    }

    expect(unsafeMatches).toEqual([]);
  }, 30_000);

  test("packed tarball installs a runnable trimctx binary", async () => {
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const tempDir = await mkdtemp(path.join(tmpdir(), "trimctx-pack-smoke-"));
    const prefix = path.join(tempDir, "prefix");

    try {
      const tarball = await packTarball(tempDir);
      await mkdir(path.join(prefix, "lib"), { recursive: true });
      await execFileAsync(npmBin, ["install", "--global", "--prefix", prefix, tarball, "--cache", npmCacheDir()], {
        cwd: tempDir,
        env: npmCommandEnv(),
        shell: process.platform === "win32"
      });

      const trimctxBin = installedTrimctxBinary(prefix);
      const version = await execFileAsync(trimctxBin, ["--version"], { shell: process.platform === "win32" });
      const help = await execFileAsync(trimctxBin, ["--help"], { shell: process.platform === "win32" });

      expect(version.stdout.trim()).toBe(packageJson.version);
      expect(help.stdout).toContain("Usage: trimctx [options] [command]");
      expect(help.stdout).toContain("Commands:");
      expect(help.stdout).toContain("init [options]");
      expect(help.stdout).toContain("analyze [options] [file]");
      expect(help.stdout).toContain("handoff [options] [file]");
      expect(help.stdout).not.toContain("session-env");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 60_000);
});
