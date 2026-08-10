import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { parseJsonl } from "../src/core/analyzer.js";

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

function installedPackageRoot(prefix: string): string {
  return process.platform === "win32"
    ? path.join(prefix, "node_modules", "trimctx")
    : path.join(prefix, "lib", "node_modules", "trimctx");
}

describe("package contents", () => {
  test("includes Claude plugin and Codex skill integration files", async () => {
    const files = await listPackedFiles();

    expect(files).toContain("install.sh");
    expect(files).toContain("install.ps1");
    expect(files).toContain("plugins/trimctx/.claude-plugin/plugin.json");
    expect(files).toContain("plugins/trimctx/.trimctx-install-marker");
    expect(files).toContain("plugins/trimctx/.system");
    expect(files).toContain("plugins/trimctx/commands/trimctx.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/analyze.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/compress.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/new-chat.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/export.md");
    expect(files).not.toContain("plugins/trimctx/commands/trimctx/transcript.md");
    expect(files).not.toContain("plugins/trimctx/commands/trimctx/handoff.md");
    expect(files).not.toContain("plugins/trimctx/commands/trimctx/resume.md");
    expect(files).toContain("codex/skills/trimctx/SKILL.md");
  }, 30_000);

  test("documents the supported analysis and hook entry points in client assets", async () => {
    const exportAsset = "plugins/trimctx/commands/trimctx/export.md";
    await expect(access(exportAsset)).resolves.toBeUndefined();

    const [claudeCommand, exportCommand, pluginReadme, pluginSystem, codexSkill] = await Promise.all([
      readFile("plugins/trimctx/commands/trimctx.md", "utf8"),
      readFile(exportAsset, "utf8"),
      readFile("plugins/trimctx/README.md", "utf8"),
      readFile("plugins/trimctx/.system", "utf8"),
      readFile("codex/skills/trimctx/SKILL.md", "utf8")
    ]);

    expect(claudeCommand).toContain('trimctx analyze "$TRIMCTX_TRANSCRIPT_PATH" --color');
    expect(claudeCommand).not.toContain("only selects the latest local JSONL file");
    expect(exportCommand).toContain('trimctx export "$TRIMCTX_TRANSCRIPT_PATH" -o conversation.md');
    expect(exportCommand).toContain("unredacted");
    expect(exportCommand).toContain("review");
    expect(pluginReadme).toContain("`trimctx init --with-hooks`");
    expect(pluginReadme).toContain("SessionStart writes the current binding through `CLAUDE_ENV_FILE`");
    expect(pluginReadme).toContain("Stop may update only the trimctx-managed block");
    expect(pluginSystem).toContain(
      "`trimctx` analyzes only the transcript bound by `TRIMCTX_TRANSCRIPT_PATH`"
    );
    expect(pluginSystem).toContain(
      "Use `trimctx analyze --latest` for explicit latest-session discovery"
    );
    expect(pluginSystem).not.toContain("trimctx current");
    expect(codexSkill).toContain("trimctx analyze --latest --source codex --color");
    expect(codexSkill).toContain("trimctx report <file.jsonl> -o report.md");
    expect(codexSkill).toContain("trimctx export <file.jsonl> -o conversation.md");
    expect(codexSkill).not.toContain("trimctx current");
  });

  test("publishes only the bundled CLI, not the source or expanded module tree", async () => {
    const files = await listPackedFiles();

    expect(files).toContain("dist/cli.js");
    expect(files.some((file) => file.startsWith("src/"))).toBe(false);
    expect(files.some((file) => file.endsWith(".ts"))).toBe(false);
    expect(files.some((file) => file.endsWith(".d.ts"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/core/"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/adapters/"))).toBe(false);
    expect(files.some((file) => file.startsWith("dist/types/"))).toBe(false);
    expect(files.some((file) => file.endsWith(".jsonl"))).toBe(false);
    expect(files.some((file) => file.startsWith("tmp-real-validation/"))).toBe(false);
    expect(files.some((file) => file.startsWith(".vscode/"))).toBe(false);
    expect(files.filter((file) => file.startsWith("docs/dev/")).sort()).toEqual([
      "docs/dev/requirements.md",
      "docs/dev/roadmap.md"
    ]);
    expect(files).toContain("CONTRIBUTING.md");
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
      const packageRoot = installedPackageRoot(prefix);
      const version = await execFileAsync(trimctxBin, ["--version"], { shell: process.platform === "win32" });
      const help = await execFileAsync(trimctxBin, ["--help"], { shell: process.platform === "win32" });
      const analyzeHelp = await execFileAsync(trimctxBin, ["analyze", "--help"], {
        shell: process.platform === "win32"
      });
      const exportHelp = await execFileAsync(trimctxBin, ["export", "--help"], {
        shell: process.platform === "win32"
      });
      const transcriptSource = path.resolve("tests", "fixtures", "openai-chat.jsonl");
      const transcriptOutput = path.join(tempDir, "conversation.md");
      const transcriptSourceBefore = await readFile(transcriptSource);
      const transcriptMessages = parseJsonl(transcriptSourceBefore.toString("utf8"), transcriptSource);
      await execFileAsync(trimctxBin, ["export", transcriptSource, "-o", transcriptOutput], {
        shell: process.platform === "win32"
      });

      await expect(access(path.join(packageRoot, "plugins", "trimctx", "commands", "trimctx", "new-chat.md"))).resolves.toBeUndefined();
      await expect(access(path.join(packageRoot, "plugins", "trimctx", "commands", "trimctx", "export.md"))).resolves.toBeUndefined();
      await expect(access(path.join(packageRoot, "plugins", "trimctx", "commands", "trimctx", "transcript.md"))).rejects.toThrow();
      await expect(access(path.join(packageRoot, "plugins", "trimctx", "commands", "trimctx", "handoff.md"))).rejects.toThrow();
      await expect(access(path.join(packageRoot, "plugins", "trimctx", "commands", "trimctx", "resume.md"))).rejects.toThrow();
      expect(version.stdout.trim()).toBe(packageJson.version);
      expect(help.stdout).toContain("Usage: trimctx [options] [command]");
      expect(help.stdout).toContain("Commands:");
      expect(help.stdout).toContain("init [options]");
      expect(help.stdout).toContain("analyze [options] [file]");
      for (const command of ["init", "analyze", "report", "export", "new-chat", "compress"]) {
        expect(help.stdout).toContain(`${command} [options]`);
      }
      expect(help.stdout).not.toContain("transcript [options]");
      for (const command of ["current", "handoff", "install-hooks", "hook", "session-env"]) {
        expect(help.stdout).not.toContain(`${command} [options]`);
      }
      expect(analyzeHelp.stdout).toContain("--select");
      expect(analyzeHelp.stdout).toContain("--latest");
      expect(analyzeHelp.stdout).toContain("--source");
      expect(analyzeHelp.stdout).not.toContain("--recent-window");
      expect(analyzeHelp.stdout).not.toContain("--remove-threshold");
      expect(analyzeHelp.stdout).not.toContain("--compress-threshold");
      expect(exportHelp.stdout).toContain("Usage: trimctx export [options] [file]");
      expect(exportHelp.stdout).toContain("trusted current-window binding");
      expect(exportHelp.stdout).toContain("-o, --output <conversation.md>");
      const transcriptMarkdown = await readFile(transcriptOutput, "utf8");
      expect(transcriptMarkdown).toContain("# trimctx Conversation Transcript");
      expect(transcriptMarkdown.match(/^### Message \d+ - /gm)).toHaveLength(transcriptMessages.length);
      for (let index = 0; index < transcriptMessages.length; index += 1) {
        expect(eventSection(transcriptMarkdown, index + 1)).toContain(transcriptMessages[index]!.content);
      }
      expect(await readFile(transcriptSource)).toEqual(transcriptSourceBefore);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }, 60_000);
});

function eventSection(markdown: string, sequence: number): string {
  const start = markdown.indexOf(`### Message ${sequence} -`);
  const next = markdown.indexOf(`\n\n### Message ${sequence + 1} -`, start);
  return markdown.slice(start, next === -1 ? undefined : next);
}
