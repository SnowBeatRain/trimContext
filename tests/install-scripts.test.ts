import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_URL = "https://example.invalid/owner/trimctx.git";
const MARKER_NAME = ".trimctx-install-marker";
const MARKER_CONTENT = "trimctx-plugin-v1\n";

describe("GitHub installer ownership boundaries", () => {
  test("rejects an unknown checkout without deleting it", async () => {
    const fixture = await createFixture();
    const sentinel = join(fixture.installDir, "sentinel.txt");
    await mkdir(fixture.installDir, { recursive: true });
    await writeFile(sentinel, "user-owned checkout", "utf8");

    const result = await runInstaller(fixture);

    expect(result.code).not.toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("user-owned checkout");
  });

  test("rejects an existing checkout whose origin does not match", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    const sentinel = join(fixture.installDir, "sentinel.txt");
    await writeFile(sentinel, "checkout stays", "utf8");

    const result = await runInstaller(fixture, {
      fakeGitOrigin: "https://example.invalid/other/repository.git"
    });

    expect(result.code).not.toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("checkout stays");
    await expect(access(fixture.pluginDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("rejects an unknown plugin directory without deleting it", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    const sentinel = join(fixture.pluginDir, "sentinel.txt");
    await mkdir(fixture.pluginDir, { recursive: true });
    await writeFile(sentinel, "user-owned plugin", "utf8");

    const result = await runInstaller(fixture);

    expect(result.code).not.toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("user-owned plugin");
  });

  test("rejects a plugin directory with an invalid marker", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    const sentinel = join(fixture.pluginDir, "sentinel.txt");
    await mkdir(fixture.pluginDir, { recursive: true });
    await writeFile(join(fixture.pluginDir, MARKER_NAME), "other-product\n", "utf8");
    await writeFile(sentinel, "invalid marker stays", "utf8");

    const result = await runInstaller(fixture);

    expect(result.code).not.toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("invalid marker stays");
  });

  test("replaces a plugin directory with a valid marker", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    await mkdir(fixture.pluginDir, { recursive: true });
    await writeFile(join(fixture.pluginDir, MARKER_NAME), MARKER_CONTENT, "utf8");
    await writeFile(join(fixture.pluginDir, "stale.txt"), "stale", "utf8");

    const result = await runInstaller(fixture);

    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(await readFile(join(fixture.pluginDir, MARKER_NAME), "utf8")).toBe(MARKER_CONTENT);
    expect(await readFile(join(fixture.pluginDir, "current.txt"), "utf8")).toBe("current plugin");
    await expect(access(join(fixture.pluginDir, "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("migrates the exact legacy trimctx plugin fingerprint to a marker", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    await writeLegacyPlugin(fixture.pluginDir);

    const result = await runInstaller(fixture);

    expect(result.code, result.stderr || result.stdout).toBe(0);
    expect(await readFile(join(fixture.pluginDir, MARKER_NAME), "utf8")).toBe(MARKER_CONTENT);
    expect(await readFile(join(fixture.pluginDir, "current.txt"), "utf8")).toBe("current plugin");
  });

  test("rechecks plugin ownership immediately before recursive replacement", async () => {
    const fixture = await createFixture();
    await writeCheckout(fixture.installDir);
    await mkdir(fixture.pluginDir, { recursive: true });
    await writeFile(join(fixture.pluginDir, MARKER_NAME), MARKER_CONTENT, "utf8");

    const result = await runInstaller(fixture, { replacePluginAfterPreflight: true });

    expect(result.code).not.toBe(0);
    expect(await readFile(join(fixture.pluginDir, MARKER_NAME), "utf8")).toContain("other-product");
    expect(await readFile(join(fixture.pluginDir, "ownership-changed.txt"), "utf8")).toContain(
      "do not delete"
    );
  });

  test("both published scripts contain explicit target and ownership guards", async () => {
    const [powershell, shell] = await Promise.all([
      readFile("install.ps1", "utf8"),
      readFile("install.sh", "utf8")
    ]);

    for (const script of [powershell, shell]) {
      expect(script).toContain(MARKER_NAME);
      expect(script).toContain(MARKER_CONTENT.trim());
      expect(script).toContain("origin");
      expect(script).toContain("plugin.json");
      expect(script).toContain("commands");
      expect(script).toContain("trimctx.md");
    }
  });
});

interface InstallerFixture {
  root: string;
  fakeBin: string;
  installDir: string;
  binDir: string;
  pluginDir: string;
  userHome: string;
}

async function createFixture(): Promise<InstallerFixture> {
  const root = await mkdtemp(join(tmpdir(), "trimctx-install-script-"));
  const fixture = {
    root,
    fakeBin: join(root, "fake-bin"),
    installDir: join(root, "checkout"),
    binDir: join(root, "bin"),
    pluginDir: join(root, "claude", "plugins", "trimctx"),
    userHome: join(root, "home")
  };
  await mkdir(fixture.fakeBin, { recursive: true });
  await mkdir(fixture.userHome, { recursive: true });
  await writeFakeCommands(fixture.fakeBin);
  return fixture;
}

async function writeCheckout(installDir: string): Promise<void> {
  await mkdir(join(installDir, ".git"), { recursive: true });
  await mkdir(join(installDir, "plugins", "trimctx", ".claude-plugin"), { recursive: true });
  await mkdir(join(installDir, "plugins", "trimctx", "commands"), { recursive: true });
  await mkdir(join(installDir, "dist"), { recursive: true });
  await writeFile(join(installDir, "plugins", "trimctx", MARKER_NAME), MARKER_CONTENT, "utf8");
  await writeFile(join(installDir, "plugins", "trimctx", ".claude-plugin", "plugin.json"), "{}\n", "utf8");
  await writeFile(join(installDir, "plugins", "trimctx", ".system"), "trimctx\n", "utf8");
  await writeFile(join(installDir, "plugins", "trimctx", "commands", "trimctx.md"), "trimctx\n", "utf8");
  await writeFile(join(installDir, "plugins", "trimctx", "current.txt"), "current plugin", "utf8");
  await writeFile(join(installDir, "dist", "cli.js"), "#!/usr/bin/env node\n", "utf8");
}

async function writeLegacyPlugin(pluginDir: string): Promise<void> {
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await mkdir(join(pluginDir, "commands"), { recursive: true });
  await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
  await writeFile(join(pluginDir, ".system"), "trimctx legacy\n", "utf8");
  await writeFile(join(pluginDir, "commands", "trimctx.md"), "trimctx legacy\n", "utf8");
}

async function runInstaller(
  fixture: InstallerFixture,
  options: { fakeGitOrigin?: string; replacePluginAfterPreflight?: boolean } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${fixture.fakeBin}${delimiter}${env[pathKey] ?? ""}`;
  env.TRIMCTX_REPO_URL = REPO_URL;
  env.TRIMCTX_REF = "main";
  env.TRIMCTX_INSTALL_DIR = fixture.installDir;
  env.TRIMCTX_BIN_DIR = fixture.binDir;
  env.TRIMCTX_CLAUDE_PLUGIN_DIR = fixture.pluginDir;
  env.FAKE_GIT_TOPLEVEL = fixture.installDir;
  env.FAKE_GIT_ORIGIN = options.fakeGitOrigin ?? REPO_URL;
  env.FAKE_NPM_REPLACE_PLUGIN = options.replacePluginAfterPreflight ? "1" : "0";
  env.FAKE_PLUGIN_DIR = fixture.pluginDir;
  env.REAL_NODE_PATH = process.execPath;
  env.USERPROFILE = fixture.userHome;
  env.HOME = fixture.userHome;
  env.LOCALAPPDATA = join(fixture.root, "local-app-data");

  const command = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = process.platform === "win32"
    ? [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        `function global:git { & '${powershellLiteral(join(fixture.fakeBin, "git.cmd"))}' @args }`,
        `function global:npm { & '${powershellLiteral(join(fixture.fakeBin, "npm.cmd"))}' @args }`,
        `function global:node { & '${powershellLiteral(join(fixture.fakeBin, "node.cmd"))}' @args }`,
        `& '${powershellLiteral(join(process.cwd(), "install.ps1"))}'`
      ].join("; ")
    ]
    : [join(process.cwd(), "install.sh")];
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: process.cwd(),
      env,
      timeout: 20_000
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

function powershellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

async function writeFakeCommands(fakeBin: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(join(fakeBin, "node.cmd"), [
      "@echo off",
      "if \"%~1\"==\"--version\" echo v20.0.0",
      "exit /b 0",
      ""
    ].join("\r\n"), "ascii");
    await writeFile(join(fakeBin, "npm.cmd"), [
      "@echo off",
      "if not \"%FAKE_NPM_REPLACE_PLUGIN%\"==\"1\" exit /b 0",
      "> \"%FAKE_PLUGIN_DIR%\\.trimctx-install-marker\" echo other-product",
      "> \"%FAKE_PLUGIN_DIR%\\ownership-changed.txt\" echo do not delete",
      "exit /b 0",
      ""
    ].join("\r\n"), "ascii");
    await writeFile(join(fakeBin, "git.cmd"), [
      "@echo off",
      "if \"%~1\"==\"-C\" if \"%~3\"==\"rev-parse\" if \"%~4\"==\"--show-toplevel\" goto top_level",
      "if \"%~1\"==\"-C\" if \"%~3\"==\"remote\" if \"%~4\"==\"get-url\" goto origin",
      "exit /b 0",
      ":top_level",
      "echo %FAKE_GIT_TOPLEVEL%",
      "exit /b 0",
      ":origin",
      "echo %FAKE_GIT_ORIGIN%",
      "exit /b 0",
      ""
    ].join("\r\n"), "ascii");
    return;
  }

  const commands = {
    node: "#!/bin/sh\nif [ \"${1:-}\" = \"-e\" ]; then exec \"$REAL_NODE_PATH\" \"$@\"; fi\nif [ \"${1:-}\" = \"--version\" ]; then printf 'v20.0.0\\n'; fi\nif [ \"${1:-}\" = \"-p\" ]; then printf '20\\n'; fi\nexit 0\n",
    npm: [
      "#!/bin/sh",
      "if [ \"${FAKE_NPM_REPLACE_PLUGIN:-0}\" = \"1\" ]; then",
      "  printf 'other-product\\n' > \"$FAKE_PLUGIN_DIR/.trimctx-install-marker\"",
      "  printf 'do not delete\\n' > \"$FAKE_PLUGIN_DIR/ownership-changed.txt\"",
      "fi",
      "exit 0",
      ""
    ].join("\n"),
    git: [
      "#!/bin/sh",
      "if [ \"${1:-}\" = \"-C\" ] && [ \"${3:-}\" = \"rev-parse\" ] && [ \"${4:-}\" = \"--show-toplevel\" ]; then printf '%s\\n' \"$FAKE_GIT_TOPLEVEL\"; exit 0; fi",
      "if [ \"${1:-}\" = \"-C\" ] && [ \"${3:-}\" = \"remote\" ] && [ \"${4:-}\" = \"get-url\" ]; then printf '%s\\n' \"$FAKE_GIT_ORIGIN\"; exit 0; fi",
      "exit 0",
      ""
    ].join("\n")
  };
  for (const [name, content] of Object.entries(commands)) {
    const file = join(fakeBin, name);
    await writeFile(file, content, "utf8");
    await chmod(file, 0o755);
  }
}
