import { execFile } from "node:child_process";
import { access, mkdir, readFile, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { createHookCommands } from "../src/commands/hook-command.js";
import type { AnalysisReport } from "../src/types/report.js";

const execFileAsync = promisify(execFile);
const tsxLoaderPath = pathToFileURL(join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href;


describe("CLI commands", () => {
  test("prints the package.json version", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };

    const result = await runCli(["--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("--help lists only public commands", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    for (const command of ["init", "analyze", "report", "export", "new-chat", "compress"]) {
      expect(result.stdout).toContain(`${command} [options]`);
    }
    expect(result.stdout).not.toContain("transcript [options]");
    for (const command of ["current", "handoff", "install-hooks", "hook", "resume"]) {
      expect(result.stdout).not.toContain(`${command} [options]`);
    }
  });

  test("init installs Claude plugin and Codex skill into a user base directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-home-"));

    const result = await runCli(["init", "--target", "user", "--dir", home]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("installed all assets for user");
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx", "compress.md"))).toBe(true);
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(true);
    expect(await fileExists(join(home, ".claude", "settings.json"))).toBe(false);
    expect(result.stdout).toContain("trimctx init --with-hooks");
    expect(result.stdout).toContain("现在你可以这样用：");
    expect(result.stdout).toContain("/trimctx");
    expect(result.stdout).toContain("trimctx new-chat");
  });

  test("init installs Claude hooks when --with-hooks is supplied", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-hooks-home-"));

    const result = await runCli(["init", "--target", "user", "--dir", home, "--with-hooks"]);

    expect(result.code).toBe(0);
    const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8")) as {
      hooks?: {
        SessionStart?: Array<{ hooks?: Array<{ command?: string }> }>;
        Stop?: Array<{ hooks?: Array<{ command?: string }> }>;
      };
    };
    const commands = createHookCommands(process.cwd());
    expect(settings.hooks?.SessionStart?.some(group =>
      group.hooks?.some(hook => hook.command === commands.sessionStart)
    )).toBe(true);
    expect(settings.hooks?.Stop?.some(group =>
      group.hooks?.some(hook => hook.command === commands.stop)
    )).toBe(true);
    expect(result.stdout).toContain("experimental Claude hooks");
  });

  test("interactive init prompts only for target and leaves hooks uninstalled", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-prompt-home-"));

    const result = await runCliWithInput(["init", "--dir", home], "1\n");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Where should trimctx install AI-client assets?");
    expect(result.stdout).not.toContain("Enable Claude current-window hooks?");
    expect(result.stdout).toContain("installed all assets for user");
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(true);
    expect(await fileExists(join(home, ".claude", "settings.json"))).toBe(false);
  });

  test("init prompts for project install target when target is omitted", async () => {
    const project = await mkdtemp(join(tmpdir(), "trimctx-init-prompt-project-"));

    const result = await runCliWithInput(["init", "--client", "claude", "--dir", project], "2\n");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("installed claude assets for project");
    expect(await fileExists(join(project, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
  });

  test("init requires explicit target in non-interactive mode", async () => {
    const result = await runCli(["init"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("target is required in non-interactive mode");
  });

  test("init installs project-scoped assets without touching HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-real-home-"));
    const project = await mkdtemp(join(tmpdir(), "trimctx-init-project-"));

    const result = await runCli(["init", "--client", "claude", "--target", "project", "--dir", project], { HOME: home });

    expect(result.code).toBe(0);
    expect(await fileExists(join(project, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(false);
  });

  test("init refuses to overwrite installed assets unless forced", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-conflict-"));
    const staleFile = join(home, ".codex", "skills", "trimctx", "stale.md");

    const first = await runCli(["init", "--client", "codex", "--target", "user", "--dir", home]);
    await writeFile(staleFile, "old command", "utf8");
    const second = await runCli(["init", "--client", "codex", "--target", "user", "--dir", home]);
    const forced = await runCli(["init", "--client", "codex", "--target", "user", "--dir", home, "--force"]);

    expect(first.code).toBe(0);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("already exists");
    expect(forced.code).toBe(0);
    expect(await fileExists(staleFile)).toBe(false);
  });

  test("init dry-run prints paths without writing files", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-dry-run-"));

    const result = await runCli(["init", "--client", "codex", "--target", "user", "--dir", home, "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("planned codex assets for user");
    expect(result.stdout).toContain(join(home, ".codex", "skills", "trimctx"));
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(false);
    expect(result.stdout).not.toContain("安装好了");
    expect(result.stdout).not.toContain("现在你可以这样用：");
  });

  test("init rejects the removed --no-hooks option", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-explicit-no-hooks-"));

    const result = await runCli(["init", "--client", "claude", "--target", "user", "--dir", home, "--no-hooks"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--no-hooks'");
  });

  test("init rejects unknown clients and targets", async () => {
    const badClient = await runCli(["init", "--client", "vim", "--target", "user"]);
    const badTarget = await runCli(["init", "--target", "global"]);

    expect(badClient.code).not.toBe(0);
    expect(badClient.stderr).toContain("client must be one of: all, claude, codex");
    expect(badTarget.code).not.toBe(0);
    expect(badTarget.stderr).toContain("target must be one of: user, project");
  });

  test("binds analyze, report, and compress to the expected Phase 0 input SHA-256", async () => {
    const { file, dir } = await writeSessionFixture();
    const expectedSha256 = await sha256(file);
    const wrongSha256 = expectedSha256 === "0".repeat(64)
      ? "1".repeat(64)
      : "0".repeat(64);
    const rejectedReport = join(dir, "rejected.report.json");
    const rejectedCompressed = join(dir, "rejected.trimmed.jsonl");
    const mismatchEnv = { TRIMCTX_PHASE0_EXPECT_INPUT_SHA256: wrongSha256 };

    const rejectedAnalyze = await runCli(["analyze", file, "--json"], mismatchEnv);
    const rejectedReportRun = await runCli(["report", file, "-o", rejectedReport], mismatchEnv);
    const rejectedCompress = await runCli(["compress", file, "-o", rejectedCompressed], mismatchEnv);

    for (const result of [rejectedAnalyze, rejectedReportRun, rejectedCompress]) {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Input changed during Phase 0 validation");
      expect(result.stderr).not.toContain(wrongSha256);
      expect(result.stdout).toBe("");
    }
    expect(await fileExists(rejectedReport)).toBe(false);
    expect(await fileExists(rejectedCompressed)).toBe(false);

    const acceptedReport = join(dir, "accepted.report.json");
    const acceptedCompressed = join(dir, "accepted.trimmed.jsonl");
    const matchedEnv = { TRIMCTX_PHASE0_EXPECT_INPUT_SHA256: expectedSha256 };
    const acceptedAnalyze = await runCli(["analyze", file, "--json"], matchedEnv);
    const acceptedReportRun = await runCli(["report", file, "-o", acceptedReport], matchedEnv);
    const acceptedCompress = await runCli(["compress", file, "-o", acceptedCompressed], matchedEnv);

    expect(acceptedAnalyze.code).toBe(0);
    expect((JSON.parse(acceptedAnalyze.stdout) as AnalysisReport).input.file).toBe(file);
    expect(acceptedReportRun.code).toBe(0);
    expect((JSON.parse(await readFile(acceptedReport, "utf8")) as AnalysisReport).input.file).toBe(file);
    expect(acceptedCompress.code).toBe(0);
    expect(await fileExists(acceptedCompressed)).toBe(true);
  });

  test("report writes a full JSON report to the requested output file", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "report.json");

    const inputHash = await sha256(file);
    await execFileAsync("node", ["--import", tsxLoaderPath, "src/cli.ts", "report", file, "-o", output], {
      cwd: process.cwd()
    });

    const report = JSON.parse(await readFile(output, "utf8")) as AnalysisReport;
    expect(report.schema_version).toBe("trimctx.report.v2");
    expect(report.input.file).toBe(file);
    expect(report.messages.length).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(await sha256(file)).toBe(inputHash);
  });

  test("report writes a Markdown health report without modifying the input", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "report.md");
    const inputHash = await sha256(file);

    const result = await runCli(["report", file, "-o", output]);

    expect(result.code).toBe(0);
    expect(await readFile(output, "utf8")).toContain("# trimctx 会话健康报告");
    expect(await sha256(file)).toBe(inputHash);
  });

  test("report rejects unsupported output extensions before replacing an existing target", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "report.txt");
    await writeFile(output, "existing report\n", "utf8");

    const result = await runCli(["report", file, "-o", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("report output must end in .json or .md");
    expect(await readFile(output, "utf8")).toBe("existing report\n");
  });

  test("compress writes a new copy without modifying the original file", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "session.trimmed.jsonl");
    const originalBefore = await sha256(file);

    const { stdout } = await execFileAsync("node", ["--import", tsxLoaderPath, "src/cli.ts", "compress", file, "-o", output], {
      cwd: process.cwd()
    });

    expect(JSON.parse(stdout)).toMatchObject({
      output,
      summary: { total_messages: expect.any(Number) }
    });
    expect(await sha256(file)).toBe(originalBefore);
    expect(await readFile(output, "utf8")).toContain("padding 34");
  });

  test("compress rejects using the input file as output", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["compress", file, "-o", file]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Output file must be different from input file");
  });

  test("report rejects using the input file as output", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["report", file, "-o", file]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Output file must be different from input file");
  });

  test("analyze uses only the transcript bound by the current AI window", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-current-bound-home-"));
    const { file } = await writeSessionFixture();

    const result = await runCli(["analyze", "--json"], {
      HOME: home,
      TRIMCTX_TRANSCRIPT_PATH: file,
      TRIMCTX_SESSION_ID: "session"
    });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
  });

  test("analyze without a file does not fall back to the latest local session", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-current-strict-home-"));
    await writeSessionFixture(join(home, ".claude", "projects", "project-a"));

    const result = await runCli(["analyze", "--json"], { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("当前窗口尚未绑定 transcript");
    expect(result.stderr).toContain("trimctx analyze --latest");
  });

  test("analyze --latest filters local sessions by source", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-analyze-latest-home-"));
    const claude = await writeSessionFixture(join(home, ".claude", "projects", "project-a"));
    const codex = await writeSessionFixture(join(home, ".codex", "sessions", "2026", "06", "12"));

    const claudeResult = await runCli(["analyze", "--latest", "--source", "claude", "--json"], { HOME: home });
    const codexResult = await runCli(["analyze", "--latest", "--source", "codex", "--json"], { HOME: home });

    expect(claudeResult.code).toBe(0);
    expect((JSON.parse(claudeResult.stdout) as AnalysisReport).input.file).toBe(claude.file);
    expect(codexResult.code).toBe(0);
    expect((JSON.parse(codexResult.stdout) as AnalysisReport).input.file).toBe(codex.file);
  });

  test("analyze --latest gives an actionable error when no local session exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-analyze-latest-empty-home-"));

    const result = await runCli(["analyze", "--latest"], { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("trimctx analyze <file>");
    expect(result.stderr).toContain("trimctx init --with-hooks");
  });

  test("analyze --select analyzes the chosen local session without polluting JSON stdout", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-analyze-select-home-"));
    const claude = await writeSessionFixture(join(home, ".claude", "projects", "project-a"));
    const codex = await writeSessionFixture(join(home, ".codex", "sessions", "2026", "06", "12"));
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-01-02T00:00:00.000Z");
    await utimes(claude.file, newer, newer);
    await utimes(codex.file, older, older);

    const result = await runCliWithInput(["analyze", "--select", "--json"], "2\n", { HOME: home });

    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as AnalysisReport).input.file).toBe(codex.file);
    expect(result.stderr).toContain("不会恢复或切换 AI 客户端窗口");
  });

  test("hook analyzes only the transcript_path provided on stdin", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-hook-home-"));
    const project = await mkdtemp(join(tmpdir(), "trimctx-hook-project-"));
    const olderSession = await writeSessionFixture(join(home, ".claude", "projects", "project-a"));
    const newerSession = await writeLowPressureFixture(join(home, ".claude", "projects", "project-b"));
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-01-02T00:00:00.000Z");
    await utimes(olderSession.file, older, older);
    await utimes(newerSession.file, newer, newer);

    const result = await runCliWithInput(
      ["hook", "--dry-run"],
      `${JSON.stringify({ transcript_path: olderSession.file })}\n`,
      { HOME: home },
      project
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("rot candidates");
  });

  test("analyze uses TRIMCTX_TRANSCRIPT_PATH when no file argument is provided", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["analyze", "--json"], { TRIMCTX_TRANSCRIPT_PATH: file });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
  });


  test("root command analyzes TRIMCTX_TRANSCRIPT_PATH with a user summary", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli([], { TRIMCTX_TRANSCRIPT_PATH: file });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trimctx 看了一下当前会话");
    expect(result.stdout).toContain("状态:");
    expect(result.stdout).toContain("置信度:");
    expect(result.stdout).toContain("原因：");
    expect(result.stdout).toContain("下一步：");
    expect(result.stdout).toContain(file);
    expect(result.stdout).toContain("高级审计：");
    expect(result.stdout).toContain("-o report.md");
    expect(result.stdout).toContain("-o report.json");
    expect(result.stdout).toContain("本地分析，没有上传文件");
    expect(result.stdout).not.toContain("phase0:");
    expect(result.stdout).not.toContain("remove_candidate");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("root command opens the local session picker in an interactive terminal", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-root-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { file } = await writeSessionFixture(projectDir);

    const result = await runCliWithInput([], "1\n", { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trimctx 看了一下当前会话");
    expect(result.stdout).toContain(file);
    expect(result.stdout).toContain("下一步：");
    expect(result.stdout).toContain("-o report.md");
    expect(result.stderr).toContain("不会恢复或切换 AI 客户端窗口");
  });

  test("root command requires an explicit file or --latest outside an interactive terminal", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-root-noninteractive-home-"));
    await writeSessionFixture(join(home, ".claude", "projects", "project-a"));

    const result = await runCli([], { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("非交互环境");
    expect(result.stderr).toContain("trimctx analyze <file>");
    expect(result.stderr).toContain("trimctx analyze --latest");
  });

  test("new-chat uses TRIMCTX_TRANSCRIPT_PATH when no file argument is provided", async () => {
    const { file, dir } = await writeSessionFixture();

    const result = await runCli(["new-chat", "--out", join(dir, "handoffs")], { TRIMCTX_TRANSCRIPT_PATH: file });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("copyable uid: ctx_");
    expect(result.stdout).toContain("handoff:");
  });

  test("analyze rejects missing file but new-chat falls back to latest session discovery", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-new-chat-fallback-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { file, dir } = await writeSessionFixture(projectDir);

    const analyze = await runCli(["analyze", "--json"], { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });
    const newChat = await runCli(["new-chat", "--out", join(dir, "handoffs")], { HOME: home, TRIMCTX_TRANSCRIPT_PATH: "" });

    expect(analyze.code).not.toBe(0);
    expect(analyze.stderr).toContain("当前窗口尚未绑定 transcript");
    expect(newChat.code).toBe(0);
    expect(newChat.stdout).toContain("copyable uid: ctx_");
    expect(newChat.stdout).toContain(file);
  });

  test("analyze rejects conflicting session selection modes", async () => {
    const { file } = await writeSessionFixture();
    const fileAndSelect = await runCli(["analyze", file, "--select"]);
    const fileAndLatest = await runCli(["analyze", file, "--latest"]);
    const selectAndLatest = await runCli(["analyze", "--select", "--latest"]);
    const sourceOnly = await runCli(["analyze", "--source", "claude"]);
    const nonInteractiveSelect = await runCli(["analyze", "--select"]);

    expect(fileAndSelect.stderr).toContain("file cannot be used with --select or --latest");
    expect(fileAndLatest.stderr).toContain("file cannot be used with --select or --latest");
    expect(selectAndLatest.stderr).toContain("--select cannot be used with --latest");
    expect(sourceOnly.stderr).toContain("--source requires --select or --latest");
    expect(nonInteractiveSelect.stderr).toContain("--select requires an interactive terminal");
  });

  test("analyze prints a human-readable summary by default", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["analyze", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trimctx analysis");
    expect(result.stdout).toContain("状态:");
    expect(result.stdout).toContain("置信度:");
    expect(result.stdout).toContain("续接缺失:");
    expect(result.stdout).toContain("trimctx report");
    expect(result.stdout).toContain("-o report.md");
    expect(result.stdout).toContain("-o report.json");
    expect(result.stdout).not.toContain("breakdown:");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("analyze keeps zero remove candidates conservative and review-only", async () => {
    const { file } = await writeLowPressureFixture();

    const result = await runCli(["analyze", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("状态: 未知");
    expect(result.stdout).toContain("置信度: 低");
    expect(result.stdout).not.toContain("conversation is clean");
    expect(result.stdout).not.toContain("health: OK");
    expect(result.stdout).toContain("trimctx report");
  });

  test("new-chat writes a uid-based package by default", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["new-chat", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("copyable uid: ctx_");
    expect(result.stdout).toContain("uid: ctx_");
    expect(result.stdout).toContain("handoff:");
    expect(result.stdout).toContain("next-context:");
    expect(result.stdout).toContain("manifest:");
    expect(result.stdout).toContain("report:");
    expect(result.stdout).toContain("readme:");

    const uid = result.stdout.match(/uid: (ctx_[a-z0-9_]+)/)?.[1];
    expect(uid).toBeDefined();
    const packageDir = join(process.cwd(), ".trimctx", "handoffs", uid!);
    const handoffPath = join(packageDir, "handoff.md");
    const nextContextPath = join(packageDir, "next-context.md");
    const manifestPath = join(packageDir, "manifest.json");
    const reportPath = join(packageDir, "report.json");
    const readmePath = join(packageDir, "README.md");

    const handoff = await readFile(handoffPath, "utf8");
    const nextContext = await readFile(nextContextPath, "utf8");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as AnalysisReport;
    const readme = await readFile(readmePath, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema_version: string;
      health_status: string;
      health_confidence: string;
      report_schema_version: string;
      uid: string;
      files: Record<string, string>;
      files_relative: Record<string, string>;
      warnings: string[];
      input: { file: string; sha256: string; source: string; session_id?: string };
      summary: { total_messages: number; remove_candidates: number; protected_messages: number };
    };

    expect(handoff).toContain("# trimctx Handoff");
    expect(nextContext).toContain("# Next Context");
    expect(readme).toContain("# trimctx New Chat Package");
    expect(readme).toContain("next-context.md");
    expect(readme).toContain("原始 transcript 没有被修改");
    expect(report.input.source).toBe("claude-code-jsonl");
    expect(report.schema_version).toBe("trimctx.report.v2");
    expect(manifest.schema_version).toBe("trimctx.handoff_manifest.v1");
    expect(manifest.health_status).toBe(report.assessment.status);
    expect(manifest.health_confidence).toBe(report.assessment.confidence);
    expect(manifest.report_schema_version).toBe("trimctx.report.v2");
    expect(manifest.uid).toBe(uid);
    expect(manifest.input.file).toBe(file);
    expect(manifest.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.input.source).toBe("claude-code-jsonl");
    expect(manifest.input.session_id).toBe("sess-cli-1");
    expect(manifest.summary.total_messages).toBeGreaterThan(0);
    expect(manifest.summary.protected_messages).toBeGreaterThan(0);
    expect(manifest.files.handoff).toBe(handoffPath);
    expect(manifest.files.next_context).toBe(nextContextPath);
    expect(manifest.files.manifest).toBe(manifestPath);
    expect(manifest.files.report).toBe(reportPath);
    expect(manifest.files.readme).toBe(readmePath);
    expect(manifest.files_relative).toEqual({
      handoff: "handoff.md",
      next_context: "next-context.md",
      manifest: "manifest.json",
      report: "report.json",
      readme: "README.md"
    });
    expect(manifest.warnings.join("\n")).toContain("may contain original transcript content and secrets");
  });

  test("new-chat --out writes a uid-based package under a custom directory", async () => {
    const { file, dir } = await writeSessionFixture();
    const outputDir = join(dir, "handoffs");

    const result = await runCli(["new-chat", file, "--out", outputDir]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("copyable uid: ctx_");
    expect(result.stdout).toContain("uid: ctx_");
    expect(result.stdout).toContain("handoff:");
    expect(result.stdout).toContain("next-context:");
    expect(result.stdout).toContain("manifest:");
    expect(result.stdout).toContain("report:");
    expect(result.stdout).toContain("readme:");

    const uid = result.stdout.match(/uid: (ctx_[a-z0-9_]+)/)?.[1];
    expect(uid).toBeDefined();
    const packageDir = join(outputDir, uid!);
    const handoffPath = join(packageDir, "handoff.md");
    const nextContextPath = join(packageDir, "next-context.md");
    const manifestPath = join(packageDir, "manifest.json");
    const reportPath = join(packageDir, "report.json");
    const readmePath = join(packageDir, "README.md");

    const handoff = await readFile(handoffPath, "utf8");
    const nextContext = await readFile(nextContextPath, "utf8");
    const readme = await readFile(readmePath, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema_version: string;
      uid: string;
      files: Record<string, string>;
      files_relative: Record<string, string>;
      warnings: string[];
      input: { file: string; sha256: string; source: string; session_id?: string };
      summary: { total_messages: number; remove_candidates: number; protected_messages: number };
    };

    expect(await fileExists(reportPath)).toBe(true);
    expect(handoff).toContain("# trimctx Handoff");
    expect(nextContext).toContain("# Next Context");
    expect(readme).toContain("# trimctx New Chat Package");
    expect(readme).toContain("next-context.md");
    expect(readme).toContain("原始 transcript 没有被修改");
    expect(manifest.schema_version).toBe("trimctx.handoff_manifest.v1");
    expect(manifest.uid).toBe(uid);
    expect(manifest.input.file).toBe(file);
    expect(manifest.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.input.source).toBe("claude-code-jsonl");
    expect(manifest.input.session_id).toBe("sess-cli-1");
    expect(manifest.summary.total_messages).toBeGreaterThan(0);
    expect(manifest.summary.protected_messages).toBeGreaterThan(0);
    expect(manifest.files.handoff).toBe(handoffPath);
    expect(manifest.files.next_context).toBe(nextContextPath);
    expect(manifest.files.manifest).toBe(manifestPath);
    expect(manifest.files.report).toBe(reportPath);
    expect(manifest.files.readme).toBe(readmePath);
    expect(manifest.files_relative).toEqual({
      handoff: "handoff.md",
      next_context: "next-context.md",
      manifest: "manifest.json",
      report: "report.json",
      readme: "README.md"
    });
    expect(manifest.warnings.join("\n")).toContain("may contain original transcript content and secrets");
  });

  test("analyze --json matches the report command output", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "report.json");

    const analyzeResult = await runCli(["analyze", file, "--json"]);
    const reportResult = await runCli(["report", file, "-o", output]);

    expect(analyzeResult.code).toBe(0);
    expect(reportResult.code).toBe(0);
    expect(JSON.parse(analyzeResult.stdout)).toEqual(JSON.parse(await readFile(output, "utf8")));
  });

});

async function writeSessionFixture(dir = ""): Promise<{ dir: string; file: string }> {
  const targetDir = dir || await mkdtemp(join(tmpdir(), "trimctx-cli-commands-"));
  await mkdir(targetDir, { recursive: true });
  const file = join(targetDir, "session.jsonl");
  const lines = [
    '{"type":"assistant","uuid":"old-1","sessionId":"sess-cli-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"assistant","uuid":"old-2","sessionId":"sess-cli-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"user","uuid":"new-1","sessionId":"sess-cli-1","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}',
    '{"type":"assistant","uuid":"new-2","sessionId":"sess-cli-1","message":{"role":"assistant","content":"Okay use new billing endpoint"}}',
    '{"type":"system","uuid":"sys-1","sessionId":"sess-cli-1","message":{"role":"system","content":"System stays"}}',
    ...Array.from({ length: 35 }, (_, index) =>
      `{"type":"${index % 2 === 0 ? "user" : "assistant"}","uuid":"pad-${index}","sessionId":"sess-cli-1","message":{"role":"${index % 2 === 0 ? "user" : "assistant"}","content":"padding ${index}"}}`
    )
  ];
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return { dir: targetDir, file };
}

async function writeLowPressureFixture(dir = ""): Promise<{ dir: string; file: string }> {
  const targetDir = dir || await mkdtemp(join(tmpdir(), "trimctx-cli-low-pressure-"));
  await mkdir(targetDir, { recursive: true });
  const file = join(targetDir, "session.jsonl");
  const lines = [
    '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
    '{"type":"user","uuid":"user-1","message":{"role":"user","content":"Please summarize current status"}}',
    '{"type":"assistant","uuid":"assistant-1","message":{"role":"assistant","content":"Current status is clean and no old context needs removal"}}'
  ];
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return { dir: targetDir, file };
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

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
  // Windows 上 homedir() 读 USERPROFILE 而非 HOME，需要同步设置
  const effectiveEnv = env.HOME
    ? { ...process.env, ...env, USERPROFILE: env.HOME }
    : { ...process.env, ...env };
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--import", tsxLoaderPath, "src/cli.ts", ...args], {
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

async function runCliWithInput(
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = {},
  cwd = process.cwd()
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cliPath = join(process.cwd(), "src", "cli.ts");
  const effectiveEnv = env.HOME
    ? { ...process.env, TRIMCTX_FORCE_INTERACTIVE: "1", ...env, USERPROFILE: env.HOME }
    : { ...process.env, TRIMCTX_FORCE_INTERACTIVE: "1", ...env };
  const script = [
    "import { spawn } from 'node:child_process';",
    "import { PassThrough } from 'node:stream';",
    `const cliPath = ${JSON.stringify(cliPath)};`,
    `const runCwd = ${JSON.stringify(cwd)};`,
    `const tsxLoaderPath = ${JSON.stringify(tsxLoaderPath)};`,
    `const childEnv = ${JSON.stringify(effectiveEnv)};`,
    `const inputChunks = ${JSON.stringify(splitInputChunks(input))};`,
    "const child = spawn(process.execPath, ['--import', tsxLoaderPath, cliPath, ...process.argv.slice(1)], { cwd: runCwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });",
    "const stdout = new PassThrough();",
    "stdout.isTTY = true;",
    "stdout.pipe(process.stdout);",
    "child.stderr.pipe(process.stderr);",
    "child.stdin.isTTY = true;",
    "let inputIndex = 0;",
    "let outputBuffer = '';",
    "function writeNextInputChunk() {",
    "  if (inputIndex >= inputChunks.length) return;",
    "  child.stdin.write(inputChunks[inputIndex++]);",
    "}",
    "function maybeWriteInput() {",
    "  if (inputIndex === 0 && outputBuffer.includes('Choose 1 or 2 [1]:')) writeNextInputChunk();",
    "  if (inputIndex === 1 && outputBuffer.includes('Choose Y or n [Y]:')) { writeNextInputChunk(); setTimeout(() => child.stdin.end(), 20); }",
    "}",
    "child.stdout.on('data', chunk => { outputBuffer += String(chunk); stdout.write(chunk); maybeWriteInput(); });",
    "setTimeout(() => { if (inputIndex === 0) { for (const chunk of inputChunks) child.stdin.write(chunk); inputIndex = inputChunks.length; child.stdin.end(); } }, 50);",
    "child.on('exit', code => process.exit(code ?? 1));"
  ].join("\n");

  try {
    const { stdout, stderr } = await execFileAsync("node", ["--input-type=module", "-e", script, ...args], {
      cwd,
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

function splitInputChunks(input: string): string[] {
  const chunks = input.match(/[^\n]*\n|[^\n]+$/g);
  return chunks ?? [];
}
