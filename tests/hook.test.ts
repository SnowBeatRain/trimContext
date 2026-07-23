import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("hidden hook integration", () => {
  test("init --with-hooks writes SessionStart and Stop hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    const result = await runCli([
      "init", "--client", "claude", "--target", "project", "--dir", dir, "--with-hooks"
    ]);

    expect(result.code).toBe(0);
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      hooks: {
        SessionStart: Array<{ hooks: Array<{ type: string; command: string }> }>;
        Stop: Array<{ hooks: Array<{ type: string; command: string }> }>;
      };
    };
    expect(settings.hooks.SessionStart[0].hooks[0]).toEqual({
      type: "command",
      command: "trimctx hook --session-start"
    });
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({ type: "command", command: "trimctx hook" });
  });

  test("init --with-hooks preserves existing settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-preserve-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      permissions: { allow: ["Bash"] },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "other session start" }] }],
        Stop: [{ hooks: [{ type: "command", command: "other stop" }] }]
      }
    }, null, 2), "utf8");

    const result = await initWithHooks(dir);

    expect(result.code).toBe(0);
    const settings = await readSettings(settingsPath);
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
    expect(countHooks(settings, "SessionStart", "other session start")).toBe(1);
    expect(countHooks(settings, "Stop", "other stop")).toBe(1);
    expect(countHooks(settings, "SessionStart", "trimctx hook --session-start")).toBe(1);
    expect(countHooks(settings, "Stop", "trimctx hook")).toBe(1);
  });

  test("repeating init --with-hooks with --force keeps one trimctx hook per event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-repeat-"));
    const settingsPath = join(dir, ".claude", "settings.json");

    expect((await initWithHooks(dir)).code).toBe(0);
    expect((await initWithHooks(dir, ["--force"])).code).toBe(0);
    expect((await initWithHooks(dir, ["--force"])).code).toBe(0);

    const settings = await readSettings(settingsPath);
    expect(countHooks(settings, "SessionStart", "trimctx hook --session-start")).toBe(1);
    expect(countHooks(settings, "Stop", "trimctx hook")).toBe(1);
  });

  test("init --with-hooks --force replaces trimctx hooks without removing other hook groups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-force-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "trimctx hook --session-start" }] },
          { hooks: [{ type: "command", command: "other session start" }] }
        ],
        Stop: [
          { hooks: [{ type: "command", command: "trimctx hook" }] },
          { hooks: [{ type: "command", command: "other stop" }] }
        ]
      }
    }, null, 2), "utf8");

    const result = await initWithHooks(dir, ["--force"]);

    expect(result.code).toBe(0);
    const settings = await readSettings(settingsPath);
    expect(countHooks(settings, "SessionStart", "trimctx hook --session-start")).toBe(1);
    expect(countHooks(settings, "Stop", "trimctx hook")).toBe(1);
    expect(countHooks(settings, "SessionStart", "other session start")).toBe(1);
    expect(countHooks(settings, "Stop", "other stop")).toBe(1);
  });

  test("init --with-hooks --dry-run keeps sensitive existing settings private and unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-dry-run-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    const originalSettings = {
      env: {
        ANTHROPIC_AUTH_TOKEN: "dummy-secret-value",
        ANTHROPIC_BASE_URL: "https://internal.example.invalid"
      },
      permissions: { allow: ["Bash"] }
    };
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify(originalSettings, null, 2), "utf8");

    const result = await initWithHooks(dir, ["--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dry-run");
    expect(result.stdout).toContain("trimctx hook --session-start");
    expect(result.stdout).toContain("trimctx hook");
    expect(result.stdout).not.toContain("dummy-secret-value");
    expect(result.stdout).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(result.stdout).not.toContain("internal.example.invalid");
    expect(result.stdout).not.toContain("permissions");
    expect(await readSettings(settingsPath)).toEqual(originalSettings);
    expect(await fileExists(join(dir, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(false);
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

  test("SessionStart binding is analyzed through analyze --json", async () => {
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

    const analyzed = await runCli(["analyze", "--json"], parseEnvBindings(content));
    expect(analyzed.code).toBe(0);
    expect((JSON.parse(analyzed.stdout) as { input: { file: string } }).input.file).toBe(transcriptPath);
  });
});

async function initWithHooks(dir: string, extraArgs: string[] = []) {
  return await runCli([
    "init", "--client", "claude", "--target", "user", "--dir", dir, "--with-hooks", ...extraArgs
  ]);
}

type HookSettings = {
  permissions?: unknown;
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
};

async function readSettings(path: string): Promise<HookSettings> {
  return JSON.parse(await readFile(path, "utf8")) as HookSettings;
}

function countHooks(settings: HookSettings, event: string, command: string): number {
  return (settings.hooks?.[event] ?? [])
    .flatMap(group => group.hooks ?? [])
    .filter(hook => hook.command === command)
    .length;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
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
    return { code: result.code ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
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
