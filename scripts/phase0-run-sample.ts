import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { PHASE0_EXPECTED_INPUT_SHA256_ENV } from "../src/core/input-integrity.js";
import { validatePhase0CompressedArtifact } from "./phase0-compressed-validation.js";
import { createPhase0ReportSemanticSha256 } from "./phase0-report-semantics.js";
import type { Phase0SamplePlan } from "./phase0-run-plan.js";

export interface Phase0CommandResult {
  ok: boolean;
  exit_code: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface Phase0SampleResult {
  sample: string;
  input_sha256_before: string;
  input_sha256_after: string;
  input_sha256_bound: true;
  input_unchanged: boolean;
  analyze: Phase0CommandResult;
  analyze_report: Phase0AnalyzeReportEvidence;
  report: Phase0CommandResult & { report_file: string; report_sha256?: string };
  compress: Phase0CommandResult & { output_file: string; output_sha256?: string };
  summary?: unknown;
  source?: unknown;
  warnings?: unknown;
}

export type Phase0AnalyzeReportStatus = "matched" | "mismatch" | "unavailable";

export interface Phase0AnalyzeReportEvidence {
  status: Phase0AnalyzeReportStatus;
  analyze_semantic_sha256?: string;
}

export type Phase0CliRunner = (
  args: string[],
  timeoutMs: number,
  expectedInputSha256: string
) => Promise<Phase0CommandResult>;

interface ParsedReport extends Record<string, unknown> {
  schema_version: "trimctx.report.v2";
  input: {
    file: string;
    source: Phase0ReportSource;
  };
  summary: {
    total_messages: number;
    total_tokens: number;
    remove_candidates: number;
    compress_candidates: number;
    protected_messages: number;
    score_diagnostics: {
      near_remove_threshold_count: number;
      protected_high_rot_count: number;
      max_rot_score: number;
    };
  };
  messages: unknown[];
  remove_candidates: unknown[];
  compress_candidates: unknown[];
  warnings: string[];
}

const PHASE0_REPORT_SOURCES = [
  "claude-code-jsonl",
  "openai-jsonl",
  "codex-jsonl"
] as const;

type Phase0ReportSource = typeof PHASE0_REPORT_SOURCES[number];

const execFileAsync = promisify(execFile);

export async function validatePhase0Sample(
  samplePlan: Phase0SamplePlan,
  timeoutMs: number,
  runCli: Phase0CliRunner = runPhase0Cli
): Promise<Phase0SampleResult> {
  const { inputFile, reportFile, compressedFile } = samplePlan;
  const beforeHash = await sha256(inputFile);

  const analyze = await runCli(["analyze", inputFile, "--json"], timeoutMs, beforeHash);
  const reportProcess = await runCli(
    ["report", inputFile, "-o", reportFile],
    timeoutMs,
    beforeHash
  );
  const compress = await runCli(
    ["compress", inputFile, "-o", compressedFile],
    timeoutMs,
    beforeHash
  );
  const afterHash = await sha256(inputFile);
  const analyzeValidation = validateAnalyzeResult(analyze, inputFile);
  const reportValidation = await validateReportArtifact(reportProcess, reportFile, inputFile);
  const analyzeReportValidation = compareAnalyzeReportSemantics(
    analyzeValidation.parsed,
    reportValidation.parsed
  );
  const compressValidation = await validateCompressedArtifact(
    compress,
    compressedFile,
    reportValidation.parsed
  );

  const metadata = reportValidation.parsed ?? analyzeValidation.parsed;

  return {
    sample: inputFile,
    input_sha256_before: beforeHash,
    input_sha256_after: afterHash,
    input_sha256_bound: true,
    input_unchanged: beforeHash === afterHash,
    analyze: compactCommandResult(analyzeValidation.result),
    analyze_report: analyzeReportValidation,
    report: {
      ...compactCommandResult(reportValidation.result),
      report_file: reportFile,
      ...(reportValidation.sha256 ? { report_sha256: reportValidation.sha256 } : {})
    },
    compress: {
      ...compactCommandResult(compressValidation.result),
      output_file: compressedFile,
      ...(compressValidation.sha256 ? { output_sha256: compressValidation.sha256 } : {})
    },
    summary: metadata?.summary,
    source: metadata?.input?.source,
    warnings: metadata?.warnings
  };
}

export function isPhase0SampleOk(result: Phase0SampleResult): boolean {
  return result.input_sha256_bound
    && result.input_unchanged
    && result.analyze.ok
    && result.report.ok
    && result.compress.ok
    && result.analyze_report.status === "matched";
}

function compareAnalyzeReportSemantics(
  analyze: ParsedReport | undefined,
  report: ParsedReport | undefined
): Phase0AnalyzeReportEvidence {
  if (!analyze || !report) return { status: "unavailable" };

  const analyzeSha256 = createPhase0ReportSemanticSha256(analyze);
  const reportSha256 = createPhase0ReportSemanticSha256(report);
  if (!analyzeSha256 || !reportSha256) return { status: "unavailable" };

  return {
    status: analyzeSha256 === reportSha256 ? "matched" : "mismatch",
    analyze_semantic_sha256: analyzeSha256
  };
}

function validateAnalyzeResult(
  result: Phase0CommandResult,
  inputFile: string
): { result: Phase0CommandResult; parsed?: ParsedReport } {
  if (!result.ok) return { result };
  if (result.stdout === undefined || result.stdout.trim() === "") {
    return {
      result: contractFailure(result, "Analyze command returned no JSON report")
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    return {
      result: contractFailure(result, "Analyze command returned invalid JSON report")
    };
  }
  if (!isRecord(parsed)) {
    return {
      result: contractFailure(result, "Analyze command returned invalid JSON report")
    };
  }
  if (!isMinimumPhase0Report(parsed)) {
    return {
      result: contractFailure(
        result,
        "Analyze command returned invalid trimctx.report.v2 contract"
      )
    };
  }
  if (parsed.input.file !== inputFile) {
    return {
      result: contractFailure(result, "Analyze report input does not match the sample")
    };
  }
  return { result, parsed };
}

async function runPhase0Cli(
  args: string[],
  timeoutMs: number,
  expectedInputSha256: string
): Promise<Phase0CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args],
      {
        cwd: process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          [PHASE0_EXPECTED_INPUT_SHA256_ENV]: expectedInputSha256
        }
      }
    );
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

async function validateReportArtifact(
  result: Phase0CommandResult,
  reportFile: string,
  inputFile: string
): Promise<{ result: Phase0CommandResult; parsed?: ParsedReport; sha256?: string }> {
  if (!result.ok) return { result };

  let reportStat;
  try {
    reportStat = await stat(reportFile);
  } catch (error) {
    const message = isNodeError(error) && error.code === "ENOENT"
      ? `Report artifact was not created: ${reportFile}`
      : `Report artifact could not be inspected: ${reportFile}`;
    return { result: contractFailure(result, message) };
  }
  if (!reportStat.isFile()) {
    return {
      result: contractFailure(result, `Report artifact target is not a regular file: ${reportFile}`)
    };
  }

  let contents: Buffer;
  try {
    contents = await readFile(reportFile);
  } catch {
    return {
      result: contractFailure(result, `Report artifact could not be read: ${reportFile}`)
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents.toString("utf8")) as unknown;
  } catch {
    return {
      result: contractFailure(result, `Report artifact contains invalid JSON: ${reportFile}`)
    };
  }
  if (!isRecord(parsed)) {
    return {
      result: contractFailure(result, `Report artifact contains invalid JSON: ${reportFile}`)
    };
  }
  if (!isMinimumPhase0Report(parsed)) {
    return {
      result: contractFailure(
        result,
        `Report artifact contains invalid trimctx.report.v2 contract: ${reportFile}`
      )
    };
  }
  if (parsed.input.file !== inputFile) {
    return {
      result: contractFailure(
        result,
        `Report artifact input does not match the sample: ${reportFile}`
      )
    };
  }
  return {
    result,
    parsed,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

async function validateCompressedArtifact(
  result: Phase0CommandResult,
  compressedFile: string,
  report: ParsedReport | undefined
): Promise<{ result: Phase0CommandResult; sha256?: string }> {
  if (!result.ok) return { result };

  let compressedStat;
  try {
    compressedStat = await stat(compressedFile);
  } catch (error) {
    const message = isNodeError(error) && error.code === "ENOENT"
      ? `Compressed artifact was not created: ${compressedFile}`
      : `Compressed artifact could not be inspected: ${compressedFile}`;
    return { result: contractFailure(result, message) };
  }
  if (!compressedStat.isFile()) {
    return {
      result: contractFailure(
        result,
        `Compressed artifact target is not a regular file: ${compressedFile}`
      )
    };
  }

  let contents: Buffer;
  try {
    contents = await readFile(compressedFile);
  } catch {
    return {
      result: contractFailure(result, `Compressed artifact could not be read: ${compressedFile}`)
    };
  }

  if (report) {
    const validation = validatePhase0CompressedArtifact(
      contents,
      compressedFile,
      report.input.source,
      report.messages
    );
    if (validation.status !== "matched") {
      return {
        result: contractFailure(
          result,
          compressedValidationError(validation.status, compressedFile)
        )
      };
    }
  }
  return {
    result,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function compressedValidationError(
  status: "invalid_structure" | "message_set_mismatch" | "reference_unavailable",
  compressedFile: string
): string {
  if (status === "invalid_structure") {
    return `Compressed artifact contains invalid JSONL: ${compressedFile}`;
  }
  if (status === "message_set_mismatch") {
    return `Compressed artifact messages do not match report decisions: ${compressedFile}`;
  }
  return `Compressed artifact could not be validated against report decisions: ${compressedFile}`;
}

function contractFailure(result: Phase0CommandResult, error: string): Phase0CommandResult {
  return { ...result, ok: false, error };
}

function compactCommandResult(result: Phase0CommandResult): Phase0CommandResult {
  return {
    ok: result.ok,
    exit_code: result.exit_code,
    stderr: result.stderr ? truncate(result.stderr) : undefined,
    error: result.error ? truncate(result.error) : undefined
  };
}

function truncate(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}... [truncated]` : value;
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMinimumPhase0Report(value: Record<string, unknown>): value is ParsedReport {
  const input = value.input;
  const summary = value.summary;
  if (
    value.schema_version !== "trimctx.report.v2"
    || !isRecord(input)
    || typeof input.file !== "string"
    || !isPhase0ReportSource(input.source)
    || !isRecord(summary)
  ) {
    return false;
  }

  const diagnostics = summary.score_diagnostics;
  return isNonNegativeInteger(summary.total_messages)
    && isNonNegativeInteger(summary.total_tokens)
    && isNonNegativeInteger(summary.remove_candidates)
    && isNonNegativeInteger(summary.compress_candidates)
    && isNonNegativeInteger(summary.protected_messages)
    && isRecord(diagnostics)
    && isNonNegativeInteger(diagnostics.near_remove_threshold_count)
    && isNonNegativeInteger(diagnostics.protected_high_rot_count)
    && isFiniteNonNegativeNumber(diagnostics.max_rot_score)
    && Array.isArray(value.messages)
    && Array.isArray(value.remove_candidates)
    && Array.isArray(value.compress_candidates)
    && Array.isArray(value.warnings)
    && value.warnings.every((warning) => typeof warning === "string");
}

function isPhase0ReportSource(value: unknown): value is Phase0ReportSource {
  return typeof value === "string"
    && PHASE0_REPORT_SOURCES.some((source) => source === value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
