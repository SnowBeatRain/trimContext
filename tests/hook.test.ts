import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("hook commands", () => {
  test("install-hooks writes SessionStart env hook and Stop hook to settings.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    const result = await runCli(["install-hooks", "--dir", dir]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("installed experimental Claude hooks");
    expect(await fileExists(settingsPath)).toBe(true);

    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: {
        SessionStart: Array<{ hooks: Array<{ type: string; command: string }> }>;
        Stop: Array<{ hooks: Array<{ type: string; command: string }> }>;
      };
    };
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionStart[0].hooks[0].type).toBe("command");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("trimctx hook --session-start");
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("trimctx hook");
  });

  test("install-hooks dry-run prints planned config without writing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-dry-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    const result = await runCli(["install-hooks", "--dir", dir, "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dry-run");
    expect(result.stdout).toContain("trimctx hook --session-start");
    expect(result.stdout).toContain("trimctx hook");
    expect(await fileExists(settingsPath)).toBe(false);
  });

  test("install-hooks dry-run does not print existing sensitive settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-secret-"));
    const settingsDir = join(dir, ".claude");
    await mkdir(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    const originalSettings = {
      env: {
        ANTHROPIC_AUTH_TOKEN: "dummy-secret-value",
        ANTHROPIC_BASE_URL: "https://internal.example.invalid"
      },
      permissions: { allow: ["Bash"] }
    };
    await writeFile(settingsPath, JSON.stringify(originalSettings, null, 2), "utf8");

    const result = await runCli(["install-hooks", "--dir", dir, "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dry-run");
    expect(result.stdout).toContain("trimctx hook --session-start");
    expect(result.stdout).not.toContain("dummy-secret-value");
    expect(result.stdout).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.stdout).not.toContain("internal.example.invalid");
    expect(result.stdout).not.toContain("permissions");
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(originalSettings);
  });

  test("install-hooks defaults to user target when omitted", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-hooks-home-"));
    const settingsPath = join(home, ".claude", "settings.json");

    const result = await runCli(["install-hooks", "--dry-run"], { HOME: home });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(settingsPath);
    expect(result.stdout).toContain("trimctx hook --session-start");
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
    expect(forced.stdout).toContain("installed experimental Claude hooks");
  });

  test("hook --dry-run requires Claude hook transcript_path instead of falling back to latest", async () => {
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

    const result = await runCliWithInput(["hook", "--dry-run"], "{}\n", { HOME: home });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude hook input transcript_path is required");
  });

  test("hook --session-start writes the current Claude transcript binding to CLAUDE_ENV_FILE", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-"));
    const envFile = join(dir, "claude-env.sh");
    const transcriptPath = join(dir, "sess-hook-1.jsonl");
    await writeFile(transcriptPath, await readFile(join("tests", "fixtures", "claude-code-realistic.jsonl"), "utf8"), "utf8");

    const result = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ session_id: "sess-hook-1", transcript_path: transcriptPath })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );

    expect(result.code).toBe(0);
    const content = await readFile(envFile, "utf8");
    expect(content).toContain(`export TRIMCTX_TRANSCRIPT_PATH='${transcriptPath}'`);
    expect(content).toContain("export TRIMCTX_SESSION_ID='sess-hook-1'");

    const current = await runCli(["current", "--json"], parseEnvBindings(content));
    expect(current.code).toBe(0);
    expect((JSON.parse(current.stdout) as { input: { file: string } }).input.file).toBe(transcriptPath);
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

function parseEnvBindings(content: string): NodeJS.ProcessEnv {
  const bindings: NodeJS.ProcessEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^export ([A-Z0-9_]+)='(.*)'$/.exec(line);
    if (match) bindings[match[1]!] = match[2]!.replace(/'\\''/g, "'");
  }
  return bindings;
}

async function runCliWithInput(
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const effectiveEnv = env.HOME
    ? { ...process.env, ...env, USERPROFILE: env.HOME }
    : { ...process.env, ...env };

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: effectiveEnv,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("close", code => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}
