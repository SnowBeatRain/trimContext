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
  test("init installs Claude plugin and Codex skill into a user base directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-home-"));

    const result = await runCli(["init", "--dir", home]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("installed all assets for user");
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx.md"))).toBe(true);
    expect(await fileExists(join(home, ".claude", "plugins", "trimctx", "commands", "trimctx", "compress.md"))).toBe(true);
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(true);
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

    const first = await runCli(["init", "--client", "codex", "--dir", home]);
    await writeFile(staleFile, "old command", "utf8");
    const second = await runCli(["init", "--client", "codex", "--dir", home]);
    const forced = await runCli(["init", "--client", "codex", "--dir", home, "--force"]);

    expect(first.code).toBe(0);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toContain("already exists");
    expect(forced.code).toBe(0);
    expect(await fileExists(staleFile)).toBe(false);
  });

  test("init dry-run prints paths without writing files", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-init-dry-run-"));

    const result = await runCli(["init", "--client", "codex", "--dir", home, "--dry-run"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("planned codex assets for user");
    expect(result.stdout).toContain(join(home, ".codex", "skills", "trimctx"));
    expect(await fileExists(join(home, ".codex", "skills", "trimctx", "SKILL.md"))).toBe(false);
  });

  test("init rejects unknown clients and targets", async () => {
    const badClient = await runCli(["init", "--client", "vim"]);
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

    expect(JSON.parse(stdout)).toMatchObject({ total_messages: expect.any(Number) });
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
      env: { ...process.env, HOME: home }
    });

    const report = JSON.parse(stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
    expect(report.schema_version).toBe("trimctx.report.v1");
  });

  test("current analyzes the most recent Claude Code session under HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-home-"));
    const projectDir = join(home, ".claude", "projects", "project-a");
    const { file } = await writeSessionFixture(projectDir);

    const result = await runCli(["current", "--source", "claude", "--json"], { HOME: home });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AnalysisReport;
    expect(report.input.file).toBe(file);
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
    expect(result.stdout).toContain("context pressure:");
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
    expect(await readFile(output, "utf8")).toContain("# trimctx Handoff");
    expect(await readFile(output, "utf8")).toContain("## Continue From Here");
    expect(await readFile(nextContext, "utf8")).toContain("# Next Context");
    expect(await readFile(nextContext, "utf8")).toContain("trimctx analyze");
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
  try {
    const { stdout, stderr } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env }
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
