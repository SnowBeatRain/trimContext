import { execFile } from "node:child_process";
import { access, mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);


describe("hook commands", () => {
  test("install-hooks writes Stop hook to settings.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    const result = await runCli(["install-hooks", "--dir", dir]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("installed experimental Stop hook");
    expect(await fileExists(settingsPath)).toBe(true);

    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ type: string; command: string }> }> };
    };
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop[0].hooks[0].type).toBe("command");
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("trimctx hook");
  });

  test("install-hooks dry-run prints planned config without writing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-dry-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    const result = await runCli(["install-hooks", "--dir", dir, "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dry-run");
    expect(result.stdout).toContain("trimctx hook");
    expect(await fileExists(settingsPath)).toBe(false);
  });

  test("install-hooks preserves existing settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-merge-"));
    const settingsDir = join(dir, ".claude");
    await mkdir(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");

    await writeFile(settingsPath, JSON.stringify({
      permissions: { allow: ["Bash"] }
    }, null, 2), "utf8");

    const result = await runCli(["install-hooks", "--dir", dir]);

    expect(result.code).toBe(0);
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
    expect(settings.hooks).toBeDefined();
  });

  test("install-hooks skips when already installed without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-skip-"));

    await runCli(["install-hooks", "--dir", dir]);
    const second = await runCli(["install-hooks", "--dir", dir]);

    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already installed");
  });

  test("install-hooks overwrites when --force is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-force-"));

    await runCli(["install-hooks", "--dir", dir]);
    const forced = await runCli(["install-hooks", "--dir", dir, "--force"]);

    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain("installed experimental Stop hook");
  });

  test("hook --dry-run runs analysis without modifying files", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-hook-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    await mkdir(projectDir, { recursive: true });
    const sessionFile = join(projectDir, "session.jsonl");
    const lines = [
      '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System prompt"}}',
      ...Array.from({ length: 35 }, (_, i) =>
        `{"type":"${i % 2 === 0 ? "user" : "assistant"}","uuid":"pad-${i}","message":{"role":"${i % 2 === 0 ? "user" : "assistant"}","content":"padding ${i}"}}`
      )
    ];
    await writeFile(sessionFile, `${lines.join("\n")}\n`, "utf8");

    const effectiveEnv = { ...process.env, HOME: home, USERPROFILE: home };
    const shellCmd = process.platform === "win32"
      ? `printf "{}" | node --import tsx src/cli.ts hook --dry-run`
      : `printf '{}' | node --import tsx src/cli.ts hook --dry-run`;

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(shellCmd, { cwd: process.cwd(), env: effectiveEnv, shell: true }, (error, stdout, stderr) => {
        resolve({
          code: error ? (error as { code?: number }).code ?? 1 : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? ""
        });
      });
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const effectiveEnv = env.HOME
    ? { ...process.env, ...env, USERPROFILE: env.HOME }
    : { ...process.env, ...env };
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: effectiveEnv
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: result.code ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
}


