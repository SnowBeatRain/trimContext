import { execFile } from "node:child_process";
import { access, mkdir, readFile, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import type { AnalysisReport } from "../src/types/report.js";

const execFileAsync = promisify(execFile);


describe("CLI commands", () => {
  test("prints the package.json version", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };

    const result = await runCli(["--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
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
    expect(result.stdout).toContain("install-hooks");
  });

  test("init installs Claude hooks only when explicitly requested", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-hooks-home-"));

    const result = await runCli(["init", "--target", "user", "--dir", home, "--with-hooks"]);

    expect(result.code).toBe(0);
    const settings = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8")) as {
      hooks?: { Stop?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    expect(settings.hooks?.Stop?.some(group =>
      group.hooks?.some(hook => hook.command === "trimctx hook")
    )).toBe(true);
    expect(result.stdout).toContain("experimental Stop hook");
  });

  test("init prompts for user/global install target when target is omitted", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-prompt-home-"));

    const result = await runCliWithInput(["init", "--dir", home], "1\n");

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Where should trimctx install AI-client assets?");
    expect(result.stdout).toContain("installed all assets for user");
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(true);
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
  });

  test("init rejects unknown clients and targets", async () => {
    const badClient = await runCli(["init", "--client", "vim", "--target", "user"]);
    const badTarget = await runCli(["init", "--target", "global"]);

    expect(badClient.code).not.toBe(0);
    expect(badClient.stderr).toContain("client must be one of: all, claude, codex");
    expect(badTarget.code).not.toBe(0);
    expect(badTarget.stderr).toContain("target must be one of: user, project");
  });

  test("report writes a full JSON report to the requested output file", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "report.json");

    await execFileAsync("node", ["--import", "tsx", "src/cli.ts", "report", file, "-o", output], {
      cwd: process.cwd()
    });

    const report = JSON.parse(await readFile(output, "utf8")) as AnalysisReport;
    expect(report.schema_version).toBe("trimctx.report.v1");
    expect(report.input.file).toBe(file);
    expect(report.messages.length).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  test("compress writes a new copy without modifying the original file", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "session.trimmed.jsonl");
    const originalBefore = await sha256(file);

    const { stdout } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", "compress", file, "-o", output], {
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

  test("handoff rejects using the input file as output", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["handoff", file, "-o", file]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Output file must be different from input file");
  });

  test("handoff rejects next-context using the input file as output", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "handoff.md");

    const result = await runCli(["handoff", file, "-o", output, "--next-context", file]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Next context file must be different from input file");
  });

  test("handoff rejects next-context using the handoff output file", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "handoff.md");

    const result = await runCli(["handoff", file, "-o", output, "--next-context", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Next context file must be different from handoff output file");
  });

  test("resume analyzes the most recent Claude Code session under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { file } = await writeSessionFixture(projectDir);

    const { stdout } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", "resume", "--json"], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, USERPROFILE: home }
    });

    const report = JSON.parse(stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
    expect(report.schema_version).toBe("trimctx.report.v1");
    expect(report.tokenization.tokenizer).toBe("local_heuristic");
    expect(report.resume.readiness.level).toBe("blocked");
  });

  test("resume compresses the most recent Claude Code session", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-resume-compress-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { dir } = await writeSessionFixture(projectDir);
    const output = join(dir, "resume.trimmed.jsonl");

    const result = await runCli(["resume", "--compress", output], { HOME: home });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      output,
      summary: { total_messages: expect.any(Number) }
    });
    expect(await readFile(output, "utf8")).toContain("padding 34");
  });

  test("current analyzes the most recent Claude Code session under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { file } = await writeSessionFixture(projectDir);

    const result = await runCli(["current", "--source", "claude", "--json"], { HOME: home });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
    expect(report.tokenization.confidence).toBe("medium");
    expect(report.resume.readiness.score).toBeGreaterThan(0);
  });

  test("current compresses the most recent session and prints output metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-current-compress-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { dir } = await writeSessionFixture(projectDir);
    const output = join(dir, "current.trimmed.jsonl");

    const result = await runCli(["current", "--source", "claude", "--compress", output], { HOME: home });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      output,
      summary: { total_messages: expect.any(Number) }
    });
    expect(await readFile(output, "utf8")).toContain("padding 34");
  });

  test("current analyzes nested Codex sessions under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-home-"));
    const sessionDir = join(home, ".codex", "sessions", "2026", "06", "12");
    const { file } = await writeSessionFixture(sessionDir);

    const result = await runCli(["current", "--source", "codex", "--json"], { HOME: home });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
  });

  test("current auto selects the newest Claude or Codex session", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-home-"));
    const claude = await writeSessionFixture(join(home, ".claude", "projects", "project-a"));
    const codex = await writeSessionFixture(join(home, ".codex", "sessions", "2026", "06", "12"));
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-01-02T00:00:00.000Z");
    await utimes(claude.file, older, older);
    await utimes(codex.file, newer, newer);

    const result = await runCli(["current", "--json"], { HOME: home });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(codex.file);
    expect(report.resume.decisions.some((decision) => decision.text.includes("Correction"))).toBe(true);
  });

  test("hook analyzes the transcript_path provided on stdin before falling back to latest", async () => {
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

  test("current rejects unknown sources", async () => {
    const result = await runCli(["current", "--source", "unknown"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("source must be one of: auto, claude, codex");
  });

  test("applies analysis tuning flags to report output", async () => {
    const { file } = await writeSessionFixture();
    const defaultResult = await runCli(["analyze", file, "--json"]);
    const tunedResult = await runCli([
      "analyze",
      file,
      "--json",
      "--recent-window",
      "0",
      "--remove-threshold",
      "0.95",
      "--compress-threshold",
      "0.5"
    ]);

    expect(defaultResult.code).toBe(0);
    expect(tunedResult.code).toBe(0);
    const defaultReport = JSON.parse(defaultResult.stdout) as AnalysisReport;
    const tunedReport = JSON.parse(tunedResult.stdout) as AnalysisReport;

    expect(defaultReport.summary.protected_messages).toBeGreaterThan(tunedReport.summary.protected_messages);
    expect(defaultReport.summary.remove_candidates).toBeGreaterThan(tunedReport.summary.remove_candidates);
    expect(tunedReport.summary.compress_candidates).toBeGreaterThan(defaultReport.summary.compress_candidates);
  });

  test("analyze prints a human-readable summary by default", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["analyze", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trimctx analysis");
    expect(result.stdout).toContain("messages / ");
    expect(result.stdout).toContain("token estimate:");
    expect(result.stdout).toContain("tokenizer:");
    expect(result.stdout).toContain("context pressure:");
    expect(result.stdout).toContain("resume:");
    expect(result.stdout).toContain("readiness:");
    expect(result.stdout).toContain("next:");
    expect(() => JSON.parse(result.stdout)).toThrow();
  });

  test("analyze prints conservative trust signals for zero remove candidates", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["analyze", file, "--remove-threshold", "1"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("trust:");
    expect(result.stdout).toContain("0 remove candidates means nothing crossed the safe deletion threshold");
    expect(result.stdout).toContain("trimctx report");
  });

  test("handoff writes markdown and next-context files from an analysis report", async () => {
    const { file, dir } = await writeSessionFixture();
    const output = join(dir, "handoff.md");
    const nextContext = join(dir, "next-context.md");

    const result = await runCli(["handoff", file, "-o", output, "--next-context", nextContext]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("handoff:");
    const handoff = await readFile(output, "utf8");
    const nextContextMarkdown = await readFile(nextContext, "utf8");
    expect(handoff).toContain("# trimctx Handoff");
    expect(handoff).toContain("## Continue From Here");
    expect(handoff).toContain("## Resume Readiness");
    expect(nextContextMarkdown).toContain("# Continue This Session");
    expect(nextContextMarkdown).toContain("## Start Here");
    expect(nextContextMarkdown).toContain("## Operating Rules");
    expect(nextContextMarkdown).toContain("Do not modify the original JSONL transcript");
    expect(nextContextMarkdown).toContain("trimctx analyze");
  });

  test("handoff writes a uid-based package by default", async () => {
    const { file } = await writeSessionFixture();

    const result = await runCli(["handoff", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("copyable uid: ctx_");
    expect(result.stdout).toContain("uid: ctx_");
    expect(result.stdout).toContain("handoff:");
    expect(result.stdout).toContain("next-context:");
    expect(result.stdout).toContain("manifest:");
    expect(result.stdout).toContain("report:");

    const uid = result.stdout.match(/uid: (ctx_[a-z0-9_]+)/)?.[1];
    expect(uid).toBeDefined();
    const packageDir = join(process.cwd(), ".trimctx", "handoffs", uid!);
    const handoffPath = join(packageDir, "handoff.md");
    const nextContextPath = join(packageDir, "next-context.md");
    const manifestPath = join(packageDir, "manifest.json");
    const reportPath = join(packageDir, "report.json");

    const handoff = await readFile(handoffPath, "utf8");
    const nextContext = await readFile(nextContextPath, "utf8");
    const report = JSON.parse(await readFile(reportPath, "utf8")) as AnalysisReport;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema_version: string;
      uid: string;
      files: Record<string, string>;
      files_relative: Record<string, string>;
      warnings: string[];
      input: { file: string; sha256: string; source: string };
      summary: { total_messages: number; remove_candidates: number; protected_messages: number };
    };

    expect(handoff).toContain("# trimctx Handoff");
    expect(nextContext).toContain("# Next Context");
    expect(report.input.source).toBe("claude-code-jsonl");
    expect(manifest.schema_version).toBe("trimctx.handoff_manifest.v1");
    expect(manifest.uid).toBe(uid);
    expect(manifest.input.file).toBe(file);
    expect(manifest.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.input.source).toBe("claude-code-jsonl");
    expect(manifest.summary.total_messages).toBeGreaterThan(0);
    expect(manifest.summary.protected_messages).toBeGreaterThan(0);
    expect(manifest.files.handoff).toBe(handoffPath);
    expect(manifest.files.next_context).toBe(nextContextPath);
    expect(manifest.files.manifest).toBe(manifestPath);
    expect(manifest.files.report).toBe(reportPath);
    expect(manifest.files_relative).toEqual({
      handoff: "handoff.md",
      next_context: "next-context.md",
      manifest: "manifest.json",
      report: "report.json"
    });
    expect(manifest.warnings.join("\n")).toContain("may contain original transcript content and secrets");
  });

  test("handoff --out writes a uid-based handoff package under a custom directory", async () => {
    const { file, dir } = await writeSessionFixture();
    const outputDir = join(dir, "handoffs");

    const result = await runCli(["handoff", file, "--out", outputDir]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("copyable uid: ctx_");
    expect(result.stdout).toContain("uid: ctx_");
    expect(result.stdout).toContain("handoff:");
    expect(result.stdout).toContain("next-context:");
    expect(result.stdout).toContain("manifest:");
    expect(result.stdout).toContain("report:");

    const uid = result.stdout.match(/uid: (ctx_[a-z0-9_]+)/)?.[1];
    expect(uid).toBeDefined();
    const packageDir = join(outputDir, uid!);
    const handoffPath = join(packageDir, "handoff.md");
    const nextContextPath = join(packageDir, "next-context.md");
    const manifestPath = join(packageDir, "manifest.json");
    const reportPath = join(packageDir, "report.json");

    const handoff = await readFile(handoffPath, "utf8");
    const nextContext = await readFile(nextContextPath, "utf8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      schema_version: string;
      uid: string;
      files: Record<string, string>;
      files_relative: Record<string, string>;
      warnings: string[];
      input: { file: string; sha256: string; source: string };
      summary: { total_messages: number; remove_candidates: number; protected_messages: number };
    };

    expect(await fileExists(reportPath)).toBe(true);
    expect(handoff).toContain("# trimctx Handoff");
    expect(nextContext).toContain("# Next Context");
    expect(manifest.schema_version).toBe("trimctx.handoff_manifest.v1");
    expect(manifest.uid).toBe(uid);
    expect(manifest.input.file).toBe(file);
    expect(manifest.input.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.input.source).toBe("claude-code-jsonl");
    expect(manifest.summary.total_messages).toBeGreaterThan(0);
    expect(manifest.summary.protected_messages).toBeGreaterThan(0);
    expect(manifest.files.handoff).toBe(handoffPath);
    expect(manifest.files.next_context).toBe(nextContextPath);
    expect(manifest.files.manifest).toBe(manifestPath);
    expect(manifest.files.report).toBe(reportPath);
    expect(manifest.files_relative).toEqual({
      handoff: "handoff.md",
      next_context: "next-context.md",
      manifest: "manifest.json",
      report: "report.json"
    });
    expect(manifest.warnings.join("\n")).toContain("may contain original transcript content and secrets");
  });

  test("handoff rejects mixing --out with explicit output files", async () => {
    const { file, dir } = await writeSessionFixture();
    const outputDir = join(dir, "handoffs");
    const output = join(dir, "handoff.md");

    const withOutput = await runCli(["handoff", file, "-o", output, "--out", outputDir]);
    const withNextContext = await runCli(["handoff", file, "--out", outputDir, "--next-context", join(dir, "next.md")]);

    expect(withOutput.code).not.toBe(0);
    expect(withOutput.stderr).toContain("--out cannot be combined with -o/--output or --next-context");
    expect(withNextContext.code).not.toBe(0);
    expect(withNextContext.stderr).toContain("--out cannot be combined with -o/--output or --next-context");
  });

  test("handoff --out-dir alias writes a uid-based handoff package", async () => {
    const { file, dir } = await writeSessionFixture();
    const outputDir = join(dir, "handoffs-alias");

    const result = await runCli(["handoff", file, "--out-dir", outputDir]);

    expect(result.code).toBe(0);
    const uid = result.stdout.match(/uid: (ctx_[a-z0-9_]+)/)?.[1];
    expect(uid).toBeDefined();
    expect(await fileExists(join(outputDir, uid!, "handoff.md"))).toBe(true);
    expect(await fileExists(join(outputDir, uid!, "next-context.md"))).toBe(true);
    expect(await fileExists(join(outputDir, uid!, "manifest.json"))).toBe(true);
    expect(await fileExists(join(outputDir, uid!, "report.json"))).toBe(true);
  });

  test("handoff rejects --next-context without legacy output", async () => {
    const { file, dir } = await writeSessionFixture();

    const result = await runCli(["handoff", file, "--next-context", join(dir, "next.md")]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--next-context requires -o/--output");
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

  test("rejects invalid analysis tuning flags", async () => {
    const { file } = await writeSessionFixture();
    const invalidInteger = await runCli(["analyze", file, "--json", "--recent-window", "1.5"]);
    const negativeRecentWindow = await runCli(["analyze", file, "--json", "--recent-window", "-1"]);
    const invalidRemoveThreshold = await runCli(["analyze", file, "--json", "--remove-threshold", "1.1"]);
    const invalidCompressThreshold = await runCli(["analyze", file, "--json", "--compress-threshold", "-0.1"]);
    const invertedThresholds = await runCli([
      "analyze",
      file,
      "--json",
      "--remove-threshold",
      "0.5",
      "--compress-threshold",
      "0.6"
    ]);

    expect(invalidInteger.code).not.toBe(0);
    expect(invalidInteger.stderr).toContain("recent-window must be an integer");
    expect(negativeRecentWindow.code).not.toBe(0);
    expect(negativeRecentWindow.stderr).toContain("recent-window must be a non-negative integer");
    expect(invalidRemoveThreshold.code).not.toBe(0);
    expect(invalidRemoveThreshold.stderr).toContain("remove-threshold must be between 0 and 1");
    expect(invalidCompressThreshold.code).not.toBe(0);
    expect(invalidCompressThreshold.stderr).toContain("compress-threshold must be between 0 and 1");
    expect(invertedThresholds.code).not.toBe(0);
    expect(invertedThresholds.stderr).toContain("compress-threshold must be less than or equal to remove-threshold");
  });
});

async function writeSessionFixture(dir = ""): Promise<{ dir: string; file: string }> {
  const targetDir = dir || await mkdtemp(join(tmpdir(), "trimctx-cli-commands-"));
  await mkdir(targetDir, { recursive: true });
  const file = join(targetDir, "session.jsonl");
  const lines = [
    '{"type":"assistant","uuid":"old-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"assistant","uuid":"old-2","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
    '{"type":"user","uuid":"new-1","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}',
    '{"type":"assistant","uuid":"new-2","message":{"role":"assistant","content":"Okay use new billing endpoint"}}',
    '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
    ...Array.from({ length: 35 }, (_, index) =>
      `{"type":"${index % 2 === 0 ? "user" : "assistant"}","uuid":"pad-${index}","message":{"role":"${index % 2 === 0 ? "user" : "assistant"}","content":"padding ${index}"}}`
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

async function runCliWithInput(
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv = {},
  cwd = process.cwd()
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cliPath = join(process.cwd(), "src", "cli.ts");
  const tsxLoaderPath = join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs");
  const script = [
    "import { spawn } from 'node:child_process';",
    "import { PassThrough } from 'node:stream';",
    `const cliPath = ${JSON.stringify(cliPath)};`,
    `const runCwd = ${JSON.stringify(cwd)};`,
    `const tsxLoaderPath = ${JSON.stringify(tsxLoaderPath)};`,
    "const child = spawn(process.execPath, ['--import', tsxLoaderPath, cliPath, ...process.argv.slice(1)], { cwd: runCwd, stdio: ['pipe', 'pipe', 'pipe'] });",
    "const stdout = new PassThrough();",
    "stdout.isTTY = true;",
    "stdout.pipe(process.stdout);",
    "child.stdout.pipe(stdout);",
    "child.stderr.pipe(process.stderr);",
    "child.stdin.isTTY = true;",
    `child.stdin.end(${JSON.stringify(input)});`,
    "child.on('exit', code => process.exit(code ?? 1));"
  ].join("\n");

  try {
    const { stdout, stderr } = await execFileAsync("node", ["--input-type=module", "-e", script, ...args], {
      cwd,
      env: { ...process.env, TRIMCTX_FORCE_INTERACTIVE: "1", ...env }
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
