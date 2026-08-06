import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, link, mkdir, readFile, readdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const cliPath = join(projectRoot, "src", "cli.ts");
const tsxImport = pathToFileURL(join(projectRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;

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

  test("init --with-hooks rejects invalid settings without overwriting them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-invalid-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    const pluginFile = join(settingsDir, "plugins", "trimctx", "commands", "trimctx.md");
    const invalidSettings = "{broken";
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, invalidSettings, "utf8");

    const result = await initWithHooks(dir);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude settings JSON is invalid");
    expect(await readFile(settingsPath, "utf8")).toBe(invalidSettings);
    expect(await fileExists(pluginFile)).toBe(false);
  });

  test("init all preflights invalid hook settings before writing either client asset", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-invalid-all-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    const invalidSettings = "{broken private-settings-marker";
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, invalidSettings, "utf8");

    const result = await runCli([
      "init", "--client", "all", "--target", "user", "--dir", dir, "--with-hooks"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude settings JSON is invalid");
    expect(result.stderr).not.toContain("private-settings-marker");
    expect(await readFile(settingsPath, "utf8")).toBe(invalidSettings);
    expect(await fileExists(join(settingsDir, "plugins", "trimctx", "commands", "trimctx.md"))).toBe(false);
    expect(await fileExists(join(dir, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(false);
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

  test("init --with-hooks --force preserves unrelated entries in mixed hook groups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hooks-force-"));
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [
          { type: "command", command: "trimctx hook --session-start" },
          { type: "command", command: "other session start" }
        ] }],
        Stop: [{ hooks: [
          { type: "command", command: "trimctx hook" },
          { type: "command", command: "other stop" }
        ] }]
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

  test("hook rejects malformed JSON without echoing stdin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hook-invalid-json-"));
    const envFile = join(dir, "claude-env.sh");
    const secret = "hook-input-secret-value";

    const result = await runCliWithInput(
      ["hook", "--session-start"],
      `{"transcript_path":"${secret}"`,
      { CLAUDE_ENV_FILE: envFile }
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude hook input must be valid JSON");
    expect(result.stderr).not.toContain(secret);
    expect(await fileExists(envFile)).toBe(false);
  });

  test("hook modes reject invalid field types before side effects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-hook-invalid-fields-"));
    const envFile = join(dir, "claude-env.sh");
    const projectDir = join(dir, "project");
    await mkdir(projectDir, { recursive: true });

    const sessionStart = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ transcript_path: "unused.jsonl", session_id: 123 })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );
    const stop = await runCliWithInput(
      ["hook", "--dry-run"],
      `${JSON.stringify({ transcript_path: 123 })}\n`,
      {},
      projectDir
    );

    expect(sessionStart.code).not.toBe(0);
    expect(sessionStart.stderr).toContain("Claude hook input session_id must be a string");
    expect(sessionStart.stderr).not.toContain("value.replace");
    expect(await fileExists(envFile)).toBe(false);

    expect(stop.code).not.toBe(0);
    expect(stop.stderr).toContain("Claude hook input transcript_path must be a string");
    expect(stop.stderr).not.toContain("path argument");
    expect(await fileExists(join(projectDir, ".claude"))).toBe(false);
  });

  test("Stop rejects an invalid last assistant message before reading or writing project state", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-invalid-final-message-"));
    const transcriptPath = join(projectDir, "session.jsonl");
    const secret = "sensitive-final-reply";
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        uuid: "user-1",
        message: { role: "user", content: "A valid transcript" }
      })}\n`,
      "utf8"
    );
    const transcriptHash = await sha256(transcriptPath);

    const result = await runCliWithInput(
      ["hook"],
      `${JSON.stringify({
        transcript_path: transcriptPath,
        last_assistant_message: { secret }
      })}\n`,
      {},
      projectDir
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude hook input last_assistant_message must be a string");
    expect(result.stderr).not.toContain(secret);
    expect(await fileExists(join(projectDir, ".claude"))).toBe(false);
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
  });

  test("Stop includes a not-yet-persisted final assistant reply in pressure analysis", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-final-message-pressure-"));
    const transcriptPath = join(projectDir, "session.jsonl");
    const baseContent = Array.from({ length: 49_000 }, () => "base").join(" ");
    const finalReply = [
      Array.from({ length: 1_100 }, () => "final").join(" "),
      "Next step: run release checks."
    ].join("\n");
    await writeFile(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        uuid: "user-pressure",
        sessionId: "session-pressure",
        message: { role: "user", content: baseContent }
      })}\n`,
      "utf8"
    );
    const transcriptHash = await sha256(transcriptPath);

    const withoutFinalReply = await runCliWithInput(
      ["hook", "--dry-run"],
      `${JSON.stringify({ transcript_path: transcriptPath })}\n`,
      {},
      projectDir
    );
    const withFinalReply = await runCliWithInput(
      ["hook"],
      `${JSON.stringify({
        transcript_path: transcriptPath,
        last_assistant_message: finalReply
      })}\n`,
      {},
      projectDir
    );

    expect(withoutFinalReply.code).toBe(0);
    expect(withoutFinalReply.stdout).toContain("上下文压力低，无需更新");
    expect(withFinalReply.code).toBe(0);
    expect(withFinalReply.stdout).toContain("上下文状态：medium");
    const claudeMd = await readFile(join(projectDir, ".claude", "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("消息：2 条");
    expect(claudeMd).toContain("压力：MEDIUM");
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
  });

  test("hook --dry-run fails closed when CLAUDE.md cannot be read", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-unreadable-project-"));
    await mkdir(join(projectDir, ".claude", "CLAUDE.md"), { recursive: true });
    const transcriptPath = join(projectRoot, "tests", "fixtures", "claude-code-realistic.jsonl");
    const transcriptHash = await sha256(transcriptPath);

    const result = await runCliWithInput(
      ["hook", "--dry-run"],
      `${JSON.stringify({ transcript_path: transcriptPath })}\n`,
      {},
      projectDir
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Failed to read Claude context file");
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
  });

  test("hook --dry-run fails closed on ambiguous CLAUDE.md state markers", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-ambiguous-project-"));
    const claudeDir = join(projectDir, ".claude");
    const claudeMdPath = join(claudeDir, "CLAUDE.md");
    const claudeMd = "# Project\n<!-- TRIMCTX_STATE_START -->\nstale state\n";
    const transcriptPath = join(projectRoot, "tests", "fixtures", "claude-code-realistic.jsonl");
    const transcriptHash = await sha256(transcriptPath);
    await mkdir(claudeDir, { recursive: true });
    await writeFile(claudeMdPath, claudeMd, "utf8");

    const result = await runCliWithInput(
      ["hook", "--dry-run"],
      `${JSON.stringify({ transcript_path: transcriptPath })}\n`,
      {},
      projectDir
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("CLAUDE.md contains ambiguous trimctx state markers");
    expect(await readFile(claudeMdPath, "utf8")).toBe(claudeMd);
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
  });

  test("Stop removes only the managed block when context pressure is low", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-clean-project-"));
    const claudeDir = join(projectDir, ".claude");
    const claudeMdPath = join(claudeDir, "CLAUDE.md");
    const transcriptPath = join(projectRoot, "tests", "fixtures", "claude-code-realistic.jsonl");
    const transcriptHash = await sha256(transcriptPath);
    await mkdir(claudeDir, { recursive: true });
    await writeFile(claudeMdPath, [
      "# Project instructions",
      "<!-- TRIMCTX_STATE_START -->",
      "stale trimctx state",
      "<!-- TRIMCTX_STATE_END -->",
      "# Project notes",
      ""
    ].join("\n"), "utf8");

    const result = await runCliWithInput(
      ["hook"],
      `${JSON.stringify({ transcript_path: transcriptPath })}\n`,
      {},
      projectDir
    );

    expect(result.code).toBe(0);
    expect(await readFile(claudeMdPath, "utf8")).toBe(
      "# Project instructions\n\n# Project notes\n"
    );
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
    expect((await readdir(claudeDir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("Stop replaces only the managed block when context candidates exist", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-update-project-"));
    const claudeDir = join(projectDir, ".claude");
    const claudeMdPath = join(claudeDir, "CLAUDE.md");
    const transcriptPath = await writeCandidateTranscript(projectDir);
    const transcriptHash = await sha256(transcriptPath);
    await mkdir(claudeDir, { recursive: true });
    await writeFile(claudeMdPath, [
      "# Project instructions",
      "<!-- TRIMCTX_STATE_START -->",
      "stale trimctx state",
      "<!-- TRIMCTX_STATE_END -->",
      "# Project notes",
      ""
    ].join("\n"), "utf8");

    const result = await runCliWithInput(
      ["hook"],
      `${JSON.stringify({ transcript_path: transcriptPath })}\n`,
      {},
      projectDir
    );

    expect(result.code).toBe(0);
    const updated = await readFile(claudeMdPath, "utf8");
    expect(updated).toContain("# Project instructions\n");
    expect(updated).toContain("# Project notes\n");
    expect(updated).not.toContain("stale trimctx state");
    expect(updated.match(/<!-- TRIMCTX_STATE_START -->/g)).toHaveLength(1);
    expect(updated.match(/<!-- TRIMCTX_STATE_END -->/g)).toHaveLength(1);
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
    expect((await readdir(claudeDir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
  });

  test("Stop safely persists marker-like and sensitive goal text across repeated runs", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "trimctx-hook-goal-safety-project-"));
    const claudeDir = join(projectDir, ".claude");
    const claudeMdPath = join(claudeDir, "CLAUDE.md");
    const goal = "目标：Authorization: Bearer hook-secret-value 继续处理 <!-- TRIMCTX_STATE_END -->";
    const transcriptPath = await writeCandidateTranscript(projectDir, goal);
    const transcriptHash = await sha256(transcriptPath);
    const hookInput = `${JSON.stringify({ transcript_path: transcriptPath })}\n`;

    const first = await runCliWithInput(["hook"], hookInput, {}, projectDir);
    const second = await runCliWithInput(["hook"], hookInput, {}, projectDir);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const updated = await readFile(claudeMdPath, "utf8");
    expect(updated.match(/<!-- TRIMCTX_STATE_START -->/g)).toHaveLength(1);
    expect(updated.match(/<!-- TRIMCTX_STATE_END -->/g)).toHaveLength(1);
    expect(updated).toContain("Authorization: Bearer [REDACTED]");
    expect(updated).not.toContain("hook-secret-value");
    expect((await readdir(claudeDir)).filter(name => name.includes(".trimctx-"))).toEqual([]);
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
  });

  test("SessionStart rejects CLAUDE_ENV_FILE equal to the transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-conflict-"));
    const transcriptPath = join(dir, "session.jsonl");
    const original = '{"type":"user","message":{"role":"user","content":"keep original"}}\n';
    await writeFile(transcriptPath, original, "utf8");
    const transcriptHash = await sha256(transcriptPath);

    const result = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ session_id: "session", transcript_path: transcriptPath })}\n`,
      { CLAUDE_ENV_FILE: transcriptPath }
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude session env file must be different from transcript");
    expect(result.stdout).not.toContain("updated trimctx Claude session binding");
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
    expect(await readFile(transcriptPath, "utf8")).toBe(original);
  });

  test("SessionStart rejects a CLAUDE_ENV_FILE hardlink to the transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-alias-"));
    const transcriptPath = join(dir, "session.jsonl");
    const envFile = join(dir, "claude-env.sh");
    const original = '{"type":"user","message":{"role":"user","content":"keep original"}}\n';
    await writeFile(transcriptPath, original, "utf8");
    await link(transcriptPath, envFile);
    const transcriptHash = await sha256(transcriptPath);

    const result = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ session_id: "session", transcript_path: transcriptPath })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Claude session env file must be different from transcript");
    expect(await sha256(transcriptPath)).toBe(transcriptHash);
    expect(await readFile(envFile, "utf8")).toBe(original);
  });

  test("SessionStart does not create CLAUDE_ENV_FILE when transcript inspection fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-preflight-"));
    const envFile = join(dir, "claude-env.sh");

    const result = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({
        session_id: "invalid-path-session",
        transcript_path: "invalid\0transcript.jsonl"
      })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );

    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("updated trimctx Claude session binding");
    await expect(readFile(envFile)).rejects.toMatchObject({ code: "ENOENT" });
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

  test("SessionStart clears a stale session ID when the next binding omits it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-session-env-reset-"));
    const envFile = join(dir, "claude-env.sh");
    const oldTranscript = join(dir, "old-session.jsonl");
    const newTranscript = join(dir, "new-session.jsonl");
    const fixture = await readFile(join("tests", "fixtures", "claude-code-realistic.jsonl"), "utf8");
    await writeFile(oldTranscript, fixture, "utf8");
    await writeFile(newTranscript, fixture, "utf8");
    const oldHash = await sha256(oldTranscript);
    const newHash = await sha256(newTranscript);

    const first = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ session_id: "old-session", transcript_path: oldTranscript })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );
    const second = await runCliWithInput(
      ["hook", "--session-start"],
      `${JSON.stringify({ transcript_path: newTranscript })}\n`,
      { CLAUDE_ENV_FILE: envFile }
    );

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const content = await readFile(envFile, "utf8");
    expect(content.endsWith([
      `export TRIMCTX_TRANSCRIPT_PATH='${newTranscript}'`,
      "export TRIMCTX_SESSION_ID=''",
      ""
    ].join("\n"))).toBe(true);
    const bindings = parseEnvBindings(content);
    expect(bindings.TRIMCTX_SESSION_ID).toBe("");

    const analyzed = await runCli(["analyze", "--json"], bindings);
    expect(analyzed.code).toBe(0);
    expect((JSON.parse(analyzed.stdout) as { input: { file: string } }).input.file).toBe(newTranscript);
    expect(await sha256(oldTranscript)).toBe(oldHash);
    expect(await sha256(newTranscript)).toBe(newHash);
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
  env: NodeJS.ProcessEnv = {},
  cwd = projectRoot
): Promise<{ code: number; stdout: string; stderr: string }> {
  const effectiveEnv = env.HOME
    ? { ...process.env, ...env, USERPROFILE: env.HOME }
    : { ...process.env, ...env };

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxImport, cliPath, ...args], {
      cwd,
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

async function writeCandidateTranscript(directory: string, goalText?: string): Promise<string> {
  const transcriptPath = join(directory, "session.jsonl");
  const goalRecord = goalText === undefined
    ? '{"type":"user","uuid":"new-1","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}'
    : JSON.stringify({
      type: "user",
      uuid: "new-1",
      message: { role: "user", content: goalText }
    });
  const lines = [
    '{"type":"assistant","uuid":"old-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"assistant","uuid":"old-2","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    goalRecord,
    '{"type":"assistant","uuid":"new-2","message":{"role":"assistant","content":"Okay use new billing endpoint"}}',
    '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
    ...Array.from({ length: 35 }, (_, index) =>
      `{"type":"${index % 2 === 0 ? "user" : "assistant"}","uuid":"pad-${index}","message":{"role":"${index % 2 === 0 ? "user" : "assistant"}","content":"padding ${index}"}}`
    )
  ];
  await writeFile(transcriptPath, `${lines.join("\n")}\n`, "utf8");
  return transcriptPath;
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
