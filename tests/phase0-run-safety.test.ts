import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const fixture = join(process.cwd(), "tests", "fixtures", "openai-chat.jsonl");

describe("phase0 run write safety", () => {
  test("rejects colliding output names before creating the output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-collision-"));
    const inputDir = join(root, "private-input");
    const outputDir = join(root, "private-output-do-not-create");
    await mkdir(inputDir);
    await copyFile(fixture, join(inputDir, "a b.jsonl"));
    await copyFile(fixture, join(inputDir, "a_b.jsonl"));

    const failure = await runPhase0ExpectFailure(inputDir, outputDir);

    expect(failure.code).not.toBe(0);
    expect(failure.stderr).toContain(
      'Phase 0 output name collision: "a b.jsonl" and "a_b.jsonl" both map to "a_b"'
    );
    expect(failure.stderr).not.toContain(root);
    await expect(access(outputDir)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  test("rejects the input directory as output without changing its JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-same-dir-"));
    const inputDir = join(root, "private-session-data");
    const inputFile = join(inputDir, "sample.jsonl");
    await mkdir(inputDir);
    await copyFile(fixture, inputFile);
    const beforeHash = await sha256(inputFile);

    const failure = await runPhase0ExpectFailure(inputDir, inputDir);

    expect(failure.code).not.toBe(0);
    expect(failure.stderr.trim()).toBe("--dir and --out must refer to different directories");
    expect(failure.stderr).not.toContain(root);
    expect(await sha256(inputFile)).toBe(beforeHash);
    await expectNoPhase0Artifacts(inputDir);
  }, 30_000);

  test("rejects a filesystem alias of the input directory as output", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-dir-alias-"));
    const inputDir = join(root, "private-session-data");
    const aliasDir = join(root, "reports-alias");
    const inputFile = join(inputDir, "sample.jsonl");
    await mkdir(inputDir);
    await copyFile(fixture, inputFile);
    await symlink(inputDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
    const beforeHash = await sha256(inputFile);

    const failure = await runPhase0ExpectFailure(inputDir, aliasDir);

    expect(failure.code).not.toBe(0);
    expect(failure.stderr.trim()).toBe("--dir and --out must refer to different directories");
    expect(failure.stderr).not.toContain(root);
    expect(await sha256(inputFile)).toBe(beforeHash);
    await expectNoPhase0Artifacts(inputDir);
  }, 30_000);

  test("preserves existing final evidence when the summary target is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-final-evidence-"));
    const inputDir = join(root, "private-input");
    const outputDir = join(root, "private-output");
    const inputFile = join(inputDir, "sample.jsonl");
    const resultsFile = join(outputDir, "phase0-results.json");
    const summaryTarget = join(outputDir, "validation-summary.md");
    await mkdir(inputDir);
    await mkdir(outputDir);
    await copyFile(fixture, inputFile);
    await writeFile(resultsFile, "old-results\n", "utf8");
    await mkdir(summaryTarget);
    const beforeHash = await sha256(inputFile);

    const failure = await runPhase0ExpectFailure(inputDir, outputDir);

    expect(failure.code).not.toBe(0);
    expect(await readFile(resultsFile, "utf8")).toBe("old-results\n");
    expect((await lstat(summaryTarget)).isDirectory()).toBe(true);
    expect(failure.stderr).toContain("Phase 0 run artifact target must be a regular file");
    expect(await sha256(inputFile)).toBe(beforeHash);
    expect(await transactionArtifacts(outputDir)).toEqual([]);
  }, 30_000);

  test("records invalid report artifact JSON without aborting batch evidence", async () => {
    const { inputDir, outputDir, inputFile, reportFile } = await phase0SampleFixture("invalid-report");
    const privateSentinel = "private-report-artifact-content";
    const beforeHash = await sha256(inputFile);

    const [execution] = await Promise.all([
      runPhase0(inputDir, outputDir),
      mutateWhenCreated(reportFile, async () => {
        await writeFile(reportFile, `{"private":"${privateSentinel}"`, "utf8");
      })
    ]);

    expect(execution.code).toBe(0);
    const evidenceText = await readFile(join(outputDir, "phase0-results.json"), "utf8");
    const evidence = JSON.parse(evidenceText) as Phase0Evidence;
    expect(evidence.aggregate).toMatchObject({
      analyze_ok: 1,
      report_ok: 0,
      compress_ok: 1,
      input_unchanged: 1,
      failed_samples: [inputFile]
    });
    expect(evidence.results[0]).toMatchObject({
      input_unchanged: true,
      source: "openai-jsonl",
      report: {
        ok: false,
        exit_code: 0,
        error: `Report artifact contains invalid JSON: ${reportFile}`
      }
    });
    expect(evidenceText).not.toContain(privateSentinel);
    expect(await sha256(inputFile)).toBe(beforeHash);
  }, 30_000);

  test("records a missing report artifact instead of counting process exit alone", async () => {
    const { inputDir, outputDir, inputFile, reportFile } = await phase0SampleFixture("missing-report");
    const beforeHash = await sha256(inputFile);

    const [execution] = await Promise.all([
      runPhase0(inputDir, outputDir),
      mutateWhenCreated(reportFile, async () => {
        await rm(reportFile);
      })
    ]);

    expect(execution.code).toBe(0);
    const evidence = JSON.parse(
      await readFile(join(outputDir, "phase0-results.json"), "utf8")
    ) as Phase0Evidence;
    expect(evidence.aggregate).toMatchObject({
      analyze_ok: 1,
      report_ok: 0,
      compress_ok: 1,
      input_unchanged: 1,
      failed_samples: [inputFile]
    });
    expect(evidence.results[0]).toMatchObject({
      input_unchanged: true,
      source: "openai-jsonl",
      report: {
        ok: false,
        exit_code: 0,
        error: `Report artifact was not created: ${reportFile}`
      }
    });
    expect(await sha256(inputFile)).toBe(beforeHash);
  }, 30_000);

  test("records a missing compressed artifact instead of counting process exit alone", async () => {
    const { inputDir, outputDir, inputFile, compressedFile } = await phase0SampleFixture("missing-compress");
    const beforeHash = await sha256(inputFile);

    const [execution] = await Promise.all([
      runPhase0(inputDir, outputDir),
      mutateWhenCreated(compressedFile, async () => {
        await rm(compressedFile);
      })
    ]);

    expect(execution.code).toBe(0);
    const evidence = JSON.parse(
      await readFile(join(outputDir, "phase0-results.json"), "utf8")
    ) as Phase0Evidence;
    expect(evidence.aggregate).toMatchObject({
      analyze_ok: 1,
      report_ok: 1,
      compress_ok: 0,
      input_unchanged: 1,
      failed_samples: [inputFile]
    });
    expect(evidence.results[0]).toMatchObject({
      input_unchanged: true,
      source: "openai-jsonl",
      compress: {
        ok: false,
        exit_code: 0,
        error: `Compressed artifact was not created: ${compressedFile}`
      }
    });
    expect(await sha256(inputFile)).toBe(beforeHash);
  }, 30_000);
});

interface Phase0Evidence {
  aggregate: {
    analyze_ok: number;
    report_ok: number;
    compress_ok: number;
    input_unchanged: number;
    failed_samples: string[];
  };
  results: Array<{
    input_unchanged: boolean;
    source?: unknown;
    report: {
      ok: boolean;
      exit_code: number;
      error?: string;
    };
    compress: {
      ok: boolean;
      exit_code: number;
      error?: string;
    };
  }>;
}

async function phase0SampleFixture(name: string): Promise<{
  inputDir: string;
  outputDir: string;
  inputFile: string;
  reportFile: string;
  compressedFile: string;
}> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-phase0-${name}-`));
  const inputDir = join(root, "private-input");
  const outputDir = join(root, "private-output");
  const inputFile = join(inputDir, "sample.jsonl");
  await mkdir(inputDir);
  await copyFile(fixture, inputFile);
  return {
    inputDir,
    outputDir,
    inputFile,
    reportFile: join(outputDir, "sample.report.json"),
    compressedFile: join(outputDir, "sample.trimmed.jsonl")
  };
}

async function mutateWhenCreated(file: string, mutate: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await access(file);
      await mutate();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(5);
    }
  }
  throw new Error(`Timed out waiting for Phase 0 artifact: ${file}`);
}

async function runPhase0(inputDir: string, outputDir: string): Promise<{
  code: number | string | undefined;
  stdout: string;
  stderr: string;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      "scripts/phase0-run.ts",
      "--dir",
      inputDir,
      "--out",
      outputDir
    ], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? ""
    };
  }
}

async function runPhase0ExpectFailure(inputDir: string, outputDir: string): Promise<{
  code: number | string | undefined;
  stderr: string;
}> {
  const result = await runPhase0(inputDir, outputDir);
  if (result.code === 0) throw new Error("Expected phase0-run to fail before writing output");
  return { code: result.code, stderr: result.stderr };
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function expectNoPhase0Artifacts(dir: string): Promise<void> {
  const names = await readdir(dir);
  expect(names.filter((name) =>
    name.endsWith(".report.json")
    || name.endsWith(".trimmed.jsonl")
    || name === "phase0-results.json"
    || name === "validation-summary.md"
  )).toEqual([]);
}

async function transactionArtifacts(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((name) => name.includes(".trimctx-") && (name.endsWith(".stage") || name.endsWith(".bak")))
    .sort();
}
