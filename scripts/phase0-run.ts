#!/usr/bin/env npx tsx
/**
 * Phase 0 批量验证脚本
 *
 * 用法：
 *   npx tsx scripts/phase0-run.ts --dir datasets/private/raw --out reports/phase0
 *
 * 会对目录中每个 .jsonl 文件依次运行 analyze/report/compress，
 * 输出汇总 JSON 到 stdout，并在 --out 目录生成每个 session 的报告和压缩文件。
 */

import { readdir, stat, writeFile, readFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------- CLI args ----------

function parseArgs(): { dir: string; out: string } {
  const args = process.argv.slice(2);
  let dir = "datasets/private/raw";
  let out = "reports/phase0";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) dir = args[++i];
    if (args[i] === "--out" && args[i + 1]) out = args[++i];
  }
  return { dir, out };
}

// ---------- Helpers ----------

async function sha256(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function runCli(
  command: string,
  file: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const projectRoot = join(import.meta.dirname ?? process.cwd(), "..");
  const cli = join(projectRoot, "src", "cli.ts");
  try {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      ["tsx", cli, command, file, ...extraArgs],
      { cwd: projectRoot, timeout: 120_000 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr: typeof e.stderr === "string" ? e.stderr : String(err),
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// ---------- Main ----------

async function main(): Promise<void> {
  const { dir, out } = parseArgs();

  await mkdir(out, { recursive: true });

  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".jsonl")).sort();

  if (files.length === 0) {
    console.error(`No .jsonl files found in ${dir}`);
    process.exit(1);
  }

  interface SessionResult {
    file: string;
    input_hash: string;
    analyze_exit: number;
    analyze_error: string;
    report_exit: number;
    report_error: string;
    compress_exit: number;
    compress_error: string;
    output_hash_unchanged: boolean | null;
    summary: Record<string, unknown> | null;
  }

  const results: SessionResult[] = [];

  for (const file of files) {
    const fullPath = join(dir, file);
    const name = basename(file, ".jsonl");
    const inputHash = await sha256(fullPath);

    process.stderr.write(`\n=== ${file} ===\n`);

    // analyze --json
    process.stderr.write("  analyze...");
    const analyzeResult = await runCli("analyze", fullPath, ["--json"]);
    process.stderr.write(` exit=${analyzeResult.exitCode}\n`);

    let summary: Record<string, unknown> | null = null;
    if (analyzeResult.exitCode === 0) {
      try {
        summary = JSON.parse(analyzeResult.stdout) as Record<string, unknown>;
      } catch {
        // parse error — leave summary null
      }
    }

    // report
    const reportPath = join(out, `${name}.report.json`);
    process.stderr.write("  report...");
    const reportResult = await runCli("report", fullPath, ["-o", reportPath]);
    process.stderr.write(` exit=${reportResult.exitCode}\n`);

    // compress
    const compressPath = join(out, `${name}.trimmed.jsonl`);
    process.stderr.write("  compress...");
    const compressResult = await runCli("compress", fullPath, [
      "-o",
      compressPath,
    ]);
    process.stderr.write(` exit=${compressResult.exitCode}\n`);

    // verify input unchanged
    const postHash = await sha256(fullPath);
    const hashUnchanged = inputHash === postHash;

    results.push({
      file,
      input_hash: inputHash,
      analyze_exit: analyzeResult.exitCode,
      analyze_error: analyzeResult.stderr.slice(0, 200),
      report_exit: reportResult.exitCode,
      report_error: reportResult.stderr.slice(0, 200),
      compress_exit: compressResult.exitCode,
      compress_error: compressResult.stderr.slice(0, 200),
      output_hash_unchanged: hashUnchanged,
      summary,
    });
  }

  // Aggregate
  const getNum = (r: SessionResult, key: string): number => {
    const s = r.summary?.summary as Record<string, unknown> | undefined;
    return (typeof s?.[key] === "number" ? (s[key] as number) : 0);
  };

  const totalMessages = results.reduce((s, r) => s + getNum(r, "total_messages"), 0);
  const totalTokens = results.reduce((s, r) => s + getNum(r, "total_tokens"), 0);
  const totalRemove = results.reduce((s, r) => s + getNum(r, "remove_candidates"), 0);
  const allParsed = results.every((r) => r.analyze_exit === 0);
  const allHashOk = results.every((r) => r.output_hash_unchanged === true);

  const output = {
    phase: "phase-0",
    generated_at: new Date().toISOString(),
    sessions: results,
    aggregate: {
      session_count: results.length,
      total_messages: totalMessages,
      total_tokens: totalTokens,
      total_remove_candidates: totalRemove,
      all_parsed_ok: allParsed,
      all_input_hashes_unchanged: allHashOk,
    },
  };

  const outPath = join(out, "phase0-results.json");
  await writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  process.stderr.write(`\nResults written to ${outPath}\n`);
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
