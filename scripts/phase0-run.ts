#!/usr/bin/env node
import { mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  assertDistinctPhase0Directories,
  createPhase0RunPlan
} from "./phase0-run-plan.js";
import { writePhase0RunArtifacts } from "./phase0-run-output.js";
import {
  isPhase0SampleOk,
  validatePhase0Sample,
  type Phase0SampleResult
} from "./phase0-run-sample.js";

interface CliOptions {
  dir: string;
  out: string;
  timeoutMs: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = resolve(options.dir);
  const outputDir = resolve(options.out);
  await assertDistinctPhase0Directories(inputDir, outputDir);
  const files = await listJsonlFiles(inputDir);
  const plan = createPhase0RunPlan(files, outputDir);
  await mkdir(outputDir, { recursive: true });
  const results: Phase0SampleResult[] = [];

  for (const sample of plan) {
    process.stderr.write(`phase0: validating ${relative(process.cwd(), sample.inputFile)}\n`);
    results.push(await validatePhase0Sample(sample, options.timeoutMs));
  }

  const output = {
    schema_version: "trimctx.phase0.results.v2",
    generated_at: new Date().toISOString(),
    input_dir: inputDir,
    output_dir: outputDir,
    sample_count: results.length,
    aggregate: {
      analyze_ok: results.filter((result) => result.analyze.ok).length,
      analyze_report_matched: results.filter((result) => result.analyze_report.status === "matched").length,
      input_sha256_bound: results.filter((result) => result.input_sha256_bound).length,
      report_ok: results.filter((result) => result.report.ok).length,
      compress_ok: results.filter((result) => result.compress.ok).length,
      input_unchanged: results.filter((result) => result.input_unchanged).length,
      failed_samples: results.filter((result) => !isPhase0SampleOk(result)).map((result) => result.sample)
    },
    results
  };

  const json = `${JSON.stringify(output, null, 2)}\n`;
  const markdown = formatValidationSummary(output);
  await writePhase0RunArtifacts(outputDir, json, markdown);
  process.stdout.write(json);
}

function parseArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  let timeoutMs = 60_000;
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
      const parsedTimeoutMs = Number(args[index + 1]);
      if (!Number.isInteger(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
      timeoutMs = parsedTimeoutMs;
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
  return { dir: options.dir, out: options.out, timeoutMs };
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

interface Phase0Output {
  schema_version: string;
  generated_at: string;
  input_dir: string;
  output_dir: string;
  sample_count: number;
  aggregate: {
    analyze_ok: number;
    analyze_report_matched: number;
    input_sha256_bound: number;
    report_ok: number;
    compress_ok: number;
    input_unchanged: number;
    failed_samples: string[];
  };
  results: Phase0SampleResult[];
}

function formatValidationSummary(output: Phase0Output): string {
  const sourceCounts = new Map<string, number>();
  let totalMessages = 0;
  let totalTokens = 0;
  let removeCandidates = 0;
  let compressCandidates = 0;
  let protectedMessages = 0;
  let nearRemoveThreshold = 0;
  let protectedHighRot = 0;
  let maxRotScore = 0;

  for (const result of output.results) {
    const source = typeof result.source === "string" ? result.source : "unknown";
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    const summary = result.summary as Record<string, unknown> | undefined;
    totalMessages += numberField(summary, "total_messages");
    totalTokens += numberField(summary, "total_tokens");
    removeCandidates += numberField(summary, "remove_candidates");
    compressCandidates += numberField(summary, "compress_candidates");
    protectedMessages += numberField(summary, "protected_messages");
    const diagnostics = summary?.score_diagnostics as Record<string, unknown> | undefined;
    nearRemoveThreshold += numberField(diagnostics, "near_remove_threshold_count");
    protectedHighRot += numberField(diagnostics, "protected_high_rot_count");
    maxRotScore = Math.max(maxRotScore, numberField(diagnostics, "max_rot_score"));
  }

  const lines: string[] = [];
  lines.push("# Phase 0 Validation Summary");
  lines.push("");
  lines.push(`Generated at: ${output.generated_at}`);
  lines.push("");
  lines.push("## Aggregate");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Samples | ${output.sample_count} |`);
  lines.push(`| Analyze OK | ${output.aggregate.analyze_ok}/${output.sample_count} |`);
  lines.push(`| Analyze/report semantics matched | ${output.aggregate.analyze_report_matched}/${output.sample_count} |`);
  lines.push(`| Command inputs SHA-256 bound | ${output.aggregate.input_sha256_bound}/${output.sample_count} |`);
  lines.push(`| Report OK | ${output.aggregate.report_ok}/${output.sample_count} |`);
  lines.push(`| Compress OK | ${output.aggregate.compress_ok}/${output.sample_count} |`);
  lines.push(`| Input unchanged | ${output.aggregate.input_unchanged}/${output.sample_count} |`);
  lines.push(`| Failed samples | ${output.aggregate.failed_samples.length} |`);
  lines.push("");
  lines.push("## Source Coverage");
  lines.push("| Source | Samples |");
  lines.push("| --- | ---: |");
  for (const [source, count] of [...sourceCounts.entries()].sort()) {
    lines.push(`| ${source} | ${count} |`);
  }
  lines.push("");
  lines.push("## Decision Totals");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Messages | ${totalMessages} |`);
  lines.push(`| Estimated tokens | ${totalTokens} |`);
  lines.push(`| Remove candidates | ${removeCandidates} |`);
  lines.push(`| Compress candidates | ${compressCandidates} |`);
  lines.push(`| Protected messages | ${protectedMessages} |`);
  lines.push(`| Near remove threshold | ${nearRemoveThreshold} |`);
  lines.push(`| Protected high rot | ${protectedHighRot} |`);
  lines.push(`| Max rot score | ${maxRotScore.toFixed(4)} |`);
  lines.push("");
  lines.push("## Manual Review Metrics");
  lines.push("| Metric | Value |");
  lines.push("| --- | --- |");
  lines.push("| Remove candidates reviewed | Pending manual review |");
  lines.push("| Safe remove | Pending manual review |");
  lines.push("| Questionable remove | Pending manual review |");
  lines.push("| Critical false deletion | Pending manual review |");
  lines.push("| Remove candidate precision | Pending manual review |");
  lines.push("| Protected reviewed | Pending manual review |");
  lines.push("| Protected keep | Pending manual review |");
  lines.push("| Protected recall | Pending manual review |");
  lines.push("| Critical protected reviewed | Pending manual review |");
  lines.push("| Non-critical protected reviewed | Pending manual review |");
  lines.push("| Protected sample coverage | Pending manual review |");
  lines.push("| Protected review requirement met | Pending manual review |");
  lines.push("| Over protected | Pending manual review |");
  lines.push("| Missed low-value noise | Pending manual review |");
  lines.push("| Needs summary | Pending manual review |");
  lines.push("| Unclear | Pending manual review |");
  lines.push("");
  lines.push("## Known Gaps");
  lines.push("- Real private OpenAI export validation is pending unless this run explicitly includes user-provided OpenAI private samples.");
  lines.push("- Phase 0 is not complete until manual review metrics are recorded: remove candidate precision, protected recall, and critical false deletion count.");
  lines.push("- A zero-remove run can validate conservative behavior, but it cannot by itself prove remove-candidate precision.");
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("- This summary intentionally excludes raw message content.");
  lines.push("- `phase0-results.json` is private by default: it can include local paths, stderr, or error details and should not be published.");
  lines.push("- Hash comparison verifies that input JSONL files were not modified.");
  lines.push("- `compress_candidate` remains report-only and is kept during compression.");
  lines.push("- Threshold or weight changes require separate human review.");
  return `${lines.join("\n")}\n`;
}

function numberField(record: Record<string, unknown> | undefined, field: string): number {
  const value = record?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
