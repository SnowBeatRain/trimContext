#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

interface CliOptions {
  dir: string;
  out: string;
  timeoutMs: number;
}

interface SampleResult {
  sample: string;
  input_sha256_before: string;
  input_sha256_after: string;
  input_unchanged: boolean;
  analyze: CommandResult;
  report: CommandResult & { report_file: string };
  compress: CommandResult & { output_file: string };
  summary?: unknown;
  source?: unknown;
  warnings?: unknown;
}

interface CommandResult {
  ok: boolean;
  exit_code: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = resolve(options.dir);
  const outputDir = resolve(options.out);
  await mkdir(outputDir, { recursive: true });

  const files = await listJsonlFiles(inputDir);
  const results: SampleResult[] = [];

  for (const file of files) {
    process.stderr.write(`phase0: validating ${relative(process.cwd(), file)}\n`);
    results.push(await validateSample(file, outputDir, options.timeoutMs));
  }

  const output = {
    schema_version: "trimctx.phase0.results.v1",
    generated_at: new Date().toISOString(),
    input_dir: inputDir,
    output_dir: outputDir,
    sample_count: results.length,
    aggregate: {
      analyze_ok: results.filter((result) => result.analyze.ok).length,
      report_ok: results.filter((result) => result.report.ok).length,
      compress_ok: results.filter((result) => result.compress.ok).length,
      input_unchanged: results.filter((result) => result.input_unchanged).length,
      failed_samples: results.filter((result) => !isSampleOk(result)).map((result) => result.sample)
    },
    results
  };

  await writeFile(join(outputDir, "phase0-results.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = { timeoutMs: 60_000 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dir") {
      options.dir = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.dir || !options.out) {
    printUsage(1);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  return options as CliOptions;
}

function printUsage(exitCode: number): never {
  const usage = [
    "Usage: npx tsx scripts/phase0-run.ts --dir <private-jsonl-dir> --out <reports-dir>",
    "",
    "Runs analyze/report/compress over every .jsonl file in a private directory.",
    "Writes reports and trimmed copies under --out, and prints phase0-results.json to stdout."
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${usage}\n`);
  process.exit(exitCode);
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(dir, entry.name))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .jsonl files found in ${dir}`);
  }
  return files;
}

async function validateSample(file: string, outputDir: string, timeoutMs: number): Promise<SampleResult> {
  const safeName = sanitizeName(basename(file, ".jsonl"));
  const reportFile = join(outputDir, `${safeName}.report.json`);
  const compressedFile = join(outputDir, `${safeName}.trimmed.jsonl`);
  const beforeHash = await sha256(file);

  const analyze = await runCli(["analyze", file, "--json"], timeoutMs);
  const report = {
    ...(await runCli(["report", file, "-o", reportFile], timeoutMs)),
    report_file: reportFile
  };
  const compress = {
    ...(await runCli(["compress", file, "-o", compressedFile], timeoutMs)),
    output_file: compressedFile
  };
  const afterHash = await sha256(file);

  let parsedReport: { summary?: unknown; input?: { source?: unknown }; warnings?: unknown } | undefined;
  if (report.ok && await exists(reportFile)) {
    parsedReport = JSON.parse(await readFile(reportFile, "utf8"));
  } else if (analyze.ok && analyze.stdout) {
    parsedReport = JSON.parse(analyze.stdout);
  }

  return {
    sample: file,
    input_sha256_before: beforeHash,
    input_sha256_after: afterHash,
    input_unchanged: beforeHash === afterHash,
    analyze: compactCommandResult(analyze),
    report: { ...compactCommandResult(report), report_file: reportFile },
    compress: { ...compactCommandResult(compress), output_file: compressedFile },
    summary: parsedReport?.summary,
    source: parsedReport?.input?.source,
    warnings: parsedReport?.warnings
  };
}

async function runCli(args: string[], timeoutMs: number): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, exit_code: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      exit_code: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.message
    };
  }
}

function compactCommandResult(result: CommandResult): CommandResult {
  return {
    ok: result.ok,
    exit_code: result.exit_code,
    stderr: result.stderr ? truncate(result.stderr) : undefined,
    error: result.error ? truncate(result.error) : undefined
  };
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "sample";
}

function truncate(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}... [truncated]` : value;
}

function isSampleOk(result: SampleResult): boolean {
  return result.input_unchanged && result.analyze.ok && result.report.ok && result.compress.ok;
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
