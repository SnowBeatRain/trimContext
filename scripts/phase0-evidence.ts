import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Phase0CompressedValidation } from "./phase0-compressed-validation.js";

const SOURCES = ["claude-code-jsonl", "openai-jsonl", "codex-jsonl"] as const;
const SHA256 = /^[a-f0-9]{64}$/;
export type Phase0ReportSource = typeof SOURCES[number];

export interface Phase0ReportArtifact {
  sha256: string;
  semanticSha256?: string;
  source?: unknown;
  inputFile?: unknown;
  messages?: readonly unknown[];
}

export interface Phase0CompressedArtifact {
  sha256: string;
  validation: Phase0CompressedValidation;
}

export const PHASE0_VALIDATION_GATES = {
  minimum_samples: 5,
  minimum_source_samples: {
    "claude-code-jsonl": 2,
    "openai-jsonl": 1,
    "codex-jsonl": 2
  },
  analyze_success_rate: 0.95,
  report_success_rate: 0.95,
  compress_success_rate: 0.95,
  input_mutations: 0
} as const;

export interface ValidationEvidence {
  available: boolean;
  ready: boolean;
  passed: boolean;
  sample_count: number;
  source_counts: Record<Phase0ReportSource, number>;
  analyze_success_rate: number | null;
  report_success_rate: number | null;
  compress_success_rate: number | null;
  input_sha256_bound: number;
  input_unchanged: number;
  expected_analyze_report_pairs: number;
  matched_analyze_report_semantics: number;
  expected_reports: number;
  matched_reports: number;
  matched_report_hashes: number;
  matched_report_sources: number;
  matched_report_inputs: number;
  expected_compressed_artifacts: number;
  matched_compressed_artifacts: number;
  matched_compressed_hashes: number;
  structurally_valid_compressed_artifacts: number;
  matched_compressed_message_sets: number;
  issues: string[];
}

interface ValidationResult {
  sample: string;
  source: Phase0ReportSource;
  analyzeOk: boolean;
  reportOk: boolean;
  compressOk: boolean;
  inputSha256BindingPresent: boolean;
  inputUnchanged: boolean;
  analyzeReportEvidencePresent: boolean;
  analyzeReportStatus?: "matched" | "mismatch" | "unavailable";
  analyzeSemanticSha256?: string;
  reportId?: string;
  reportSha256?: string;
  compressedId?: string;
  compressedSha256?: string;
}

export async function loadPhase0ValidationEvidence(
  reportsDir: string,
  actualReports: ReadonlyMap<string, Phase0ReportArtifact>,
  actualCompressedArtifacts: ReadonlyMap<string, Phase0CompressedArtifact>
): Promise<ValidationEvidence> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(reportsDir, "phase0-results.json"), "utf8")) as unknown;
  } catch (error) {
    const issue = isNodeError(error) && error.code === "ENOENT"
      ? "missing_phase0_results"
      : isSyntaxError(error)
        ? "invalid_phase0_results"
        : "unreadable_phase0_results";
    return emptyEvidence(issue === "missing_phase0_results" ? false : true, issue);
  }

  if (isRecord(parsed) && parsed.schema_version === "trimctx.phase0.results.v1") {
    return emptyEvidence(true, "report_integrity_unavailable");
  }
  if (!isRecord(parsed)
      || parsed.schema_version !== "trimctx.phase0.results.v2"
      || !Array.isArray(parsed.results)
      || !isRecord(parsed.aggregate)) {
    return emptyEvidence(true, "invalid_phase0_results");
  }

  const results = parsed.results.map(normalizeResult);
  if (results.some((result) => result === undefined)) {
    return emptyEvidence(true, "invalid_phase0_results");
  }
  const normalized = results as ValidationResult[];
  const sampleCount = normalized.length;
  const aggregateAnalyzeReportMatched = parsed.aggregate.analyze_report_matched;
  if (aggregateAnalyzeReportMatched !== undefined
      && (!Number.isInteger(aggregateAnalyzeReportMatched)
        || (aggregateAnalyzeReportMatched as number) < 0
        || (aggregateAnalyzeReportMatched as number) > sampleCount)) {
    return emptyEvidence(true, "invalid_phase0_results");
  }
  const aggregateInputSha256Bound = parsed.aggregate.input_sha256_bound;
  if (aggregateInputSha256Bound !== undefined
      && (!Number.isInteger(aggregateInputSha256Bound)
        || (aggregateInputSha256Bound as number) < 0
        || (aggregateInputSha256Bound as number) > sampleCount)) {
    return emptyEvidence(true, "invalid_phase0_results");
  }

  const analyzeOk = normalized.filter((result) => result.analyzeOk).length;
  const reportOk = normalized.filter((result) => result.reportOk).length;
  const compressOk = normalized.filter((result) => result.compressOk).length;
  const inputSha256Bound = normalized.filter((result) =>
    result.inputSha256BindingPresent
  ).length;
  const inputUnchanged = normalized.filter((result) => result.inputUnchanged).length;
  const analyzeReportMatched = normalized.filter((result) =>
    result.analyzeReportStatus === "matched"
  ).length;
  const samples = normalized.map((result) => result.sample);
  const sampleSet = new Set(samples);
  const failedSamples = normalized.filter((result) =>
    !result.inputUnchanged
    || !result.analyzeOk
    || !result.reportOk
    || !result.compressOk
    || (result.analyzeReportEvidencePresent && result.analyzeReportStatus !== "matched")
  ).map((result) => result.sample);
  const expectedAnalyzeReportPairs = normalized.filter((result) =>
    result.analyzeOk && result.reportOk
  );
  const expectedReportIds = normalized.flatMap((result) => result.reportOk && result.reportId ? [result.reportId] : []);
  const expectedReportSet = new Set(expectedReportIds);
  const expectedCompressedIds = normalized.flatMap((result) =>
    result.compressOk && result.compressedId ? [result.compressedId] : []
  );
  const expectedCompressedSet = new Set(expectedCompressedIds);
  const expectedCompressedSha256 = new Map(normalized.flatMap((result) =>
    result.compressOk && result.compressedId && result.compressedSha256
      ? [[result.compressedId, result.compressedSha256] as const]
      : []
  ));
  const actualReportIds = new Set(actualReports.keys());
  const actualCompressedIds = new Set(actualCompressedArtifacts.keys());
  const expectedReportSha256 = new Map(normalized.flatMap((result) =>
    result.reportOk && result.reportId && result.reportSha256
      ? [[result.reportId, result.reportSha256] as const]
      : []
  ));
  const expectedReportSources = new Map(normalized.flatMap((result) =>
    result.reportOk && result.reportId
      ? [[result.reportId, result.source] as const]
      : []
  ));
  const expectedReportInputs = new Map(normalized.flatMap((result) =>
    result.reportOk && result.reportId
      ? [[result.reportId, result.sample] as const]
      : []
  ));
  const matchedReports = [...expectedReportSet].filter((id) => actualReports.has(id)).length;
  const matchedReportHashes = [...expectedReportSha256].filter(([id, expected]) =>
    actualReports.get(id)?.sha256 === expected
  ).length;
  const matchedReportSources = [...expectedReportSources].filter(([id, expected]) =>
    actualReports.get(id)?.source === expected
  ).length;
  const matchedReportInputs = [...expectedReportInputs].filter(([id, expected]) =>
    actualReports.get(id)?.inputFile === expected
  ).length;
  const matchedAnalyzeReportSemantics = expectedAnalyzeReportPairs.filter((result) =>
    result.reportId !== undefined
    && result.analyzeReportStatus === "matched"
    && result.analyzeSemanticSha256 !== undefined
    && actualReports.get(result.reportId)?.semanticSha256 === result.analyzeSemanticSha256
  ).length;
  const matchedCompressedArtifacts = [...expectedCompressedSet].filter((id) =>
    actualCompressedArtifacts.has(id)
  ).length;
  const matchedCompressedHashes = [...expectedCompressedSha256].filter(([id, expected]) =>
    actualCompressedArtifacts.get(id)?.sha256 === expected
  ).length;
  const structurallyValidCompressedArtifacts = [...expectedCompressedSet].filter((id) => {
    const status = actualCompressedArtifacts.get(id)?.validation.status;
    return status === "matched" || status === "message_set_mismatch";
  }).length;
  const matchedCompressedMessageSets = [...expectedCompressedSet].filter((id) =>
    actualCompressedArtifacts.get(id)?.validation.status === "matched"
  ).length;
  const sourceCounts = emptySourceCounts();
  for (const id of expectedReportSet) {
    const source = actualReports.get(id)?.source;
    if (isSource(source)) sourceCounts[source] += 1;
  }

  const readinessIssues: string[] = [];
  if (!Number.isInteger(parsed.sample_count) || parsed.sample_count !== sampleCount) {
    readinessIssues.push("sample_count_mismatch");
  }
  if (!aggregateMatches(
    parsed.aggregate,
    {
      analyzeOk,
      analyzeReportMatched,
      inputSha256Bound,
      reportOk,
      compressOk,
      inputUnchanged,
      failedSamples
    }
  )) {
    readinessIssues.push("aggregate_mismatch");
  }
  if (samples.length !== sampleSet.size) {
    readinessIssues.push("duplicate_samples");
  }
  if (expectedReportIds.length !== expectedReportSet.size) {
    readinessIssues.push("duplicate_report_ids");
  }
  if (expectedCompressedIds.length !== expectedCompressedSet.size) {
    readinessIssues.push("duplicate_compressed_ids");
  }
  if (!setsEqual(expectedReportSet, actualReportIds)) {
    readinessIssues.push("report_set_mismatch");
  }
  if (!setsEqual(expectedCompressedSet, actualCompressedIds)) {
    readinessIssues.push("compressed_set_mismatch");
  }
  const semanticEvidenceUnavailable = normalized.some((result) =>
    !result.analyzeReportEvidencePresent
  )
    || parsed.aggregate.analyze_report_matched === undefined
    || expectedAnalyzeReportPairs.some((result) =>
      result.reportId === undefined
      || actualReports.get(result.reportId)?.semanticSha256 === undefined
    );
  if (semanticEvidenceUnavailable) {
    readinessIssues.push("analyze_report_semantic_validation_unavailable");
  }
  const inputSha256BindingUnavailable = normalized.some((result) =>
    !result.inputSha256BindingPresent
  ) || parsed.aggregate.input_sha256_bound === undefined;
  if (inputSha256BindingUnavailable) {
    readinessIssues.push("input_sha256_binding_unavailable");
  }
  if (expectedAnalyzeReportPairs.some((result) =>
    result.analyzeReportEvidencePresent
    && (result.analyzeReportStatus === "mismatch"
      || (result.analyzeReportStatus === "matched"
        && result.reportId !== undefined
        && actualReports.get(result.reportId)?.semanticSha256 !== undefined
        && actualReports.get(result.reportId)?.semanticSha256 !== result.analyzeSemanticSha256))
  )) {
    readinessIssues.push("analyze_report_semantic_mismatch");
  }
  if (expectedCompressedSha256.size !== expectedCompressedSet.size) {
    readinessIssues.push("compressed_integrity_unavailable");
  }
  if ([...expectedCompressedSha256].some(([id, expected]) => {
    const actual = actualCompressedArtifacts.get(id)?.sha256;
    return actual !== undefined && actual !== expected;
  })) {
    readinessIssues.push("compressed_hash_mismatch");
  }
  if ([...expectedCompressedSet].some((id) =>
    actualCompressedArtifacts.get(id)?.validation.status === "invalid_structure"
  )) {
    readinessIssues.push("compressed_structure_invalid");
  }
  if ([...expectedCompressedSet].some((id) =>
    actualCompressedArtifacts.get(id)?.validation.status === "message_set_mismatch"
  )) {
    readinessIssues.push("compressed_message_set_mismatch");
  }
  if ([...expectedCompressedSet].some((id) =>
    actualCompressedArtifacts.get(id)?.validation.status === "reference_unavailable"
  )) {
    readinessIssues.push("compressed_validation_unavailable");
  }
  if ([...expectedReportSha256].some(([id, expected]) => {
    const actual = actualReports.get(id)?.sha256;
    return actual !== undefined && actual !== expected;
  })) {
    readinessIssues.push("report_hash_mismatch");
  }
  if ([...expectedReportSources].some(([id, expected]) => {
    const actual = actualReports.get(id);
    return actual !== undefined && actual.source !== expected;
  })) {
    readinessIssues.push("report_source_mismatch");
  }
  if ([...expectedReportInputs].some(([id, expected]) => {
    const actual = actualReports.get(id);
    return actual !== undefined && actual.inputFile !== expected;
  })) {
    readinessIssues.push("report_input_mismatch");
  }
  if (sampleCount < PHASE0_VALIDATION_GATES.minimum_samples) {
    readinessIssues.push("insufficient_samples");
  }
  for (const source of SOURCES) {
    if (sourceCounts[source] < PHASE0_VALIDATION_GATES.minimum_source_samples[source]) {
      readinessIssues.push(`insufficient_${sourceName(source)}_samples`);
    }
  }

  const analyzeSuccessRate = ratio(analyzeOk, sampleCount);
  const reportSuccessRate = ratio(reportOk, sampleCount);
  const compressSuccessRate = ratio(compressOk, sampleCount);
  const qualityIssues: string[] = [];
  if (analyzeSuccessRate !== null && analyzeSuccessRate < PHASE0_VALIDATION_GATES.analyze_success_rate) {
    qualityIssues.push("analyze_success_rate_below_gate");
  }
  if (reportSuccessRate !== null && reportSuccessRate < PHASE0_VALIDATION_GATES.report_success_rate) {
    qualityIssues.push("report_success_rate_below_gate");
  }
  if (compressSuccessRate !== null && compressSuccessRate < PHASE0_VALIDATION_GATES.compress_success_rate) {
    qualityIssues.push("compress_success_rate_below_gate");
  }
  if (inputUnchanged !== sampleCount) {
    qualityIssues.push("input_mutation_detected");
  }

  const ready = readinessIssues.length === 0;
  return {
    available: true,
    ready,
    passed: ready && qualityIssues.length === 0,
    sample_count: sampleCount,
    source_counts: sourceCounts,
    analyze_success_rate: analyzeSuccessRate,
    report_success_rate: reportSuccessRate,
    compress_success_rate: compressSuccessRate,
    input_sha256_bound: inputSha256Bound,
    input_unchanged: inputUnchanged,
    expected_analyze_report_pairs: expectedAnalyzeReportPairs.length,
    matched_analyze_report_semantics: matchedAnalyzeReportSemantics,
    expected_reports: expectedReportSet.size,
    matched_reports: matchedReports,
    matched_report_hashes: matchedReportHashes,
    matched_report_sources: matchedReportSources,
    matched_report_inputs: matchedReportInputs,
    expected_compressed_artifacts: expectedCompressedSet.size,
    matched_compressed_artifacts: matchedCompressedArtifacts,
    matched_compressed_hashes: matchedCompressedHashes,
    structurally_valid_compressed_artifacts: structurallyValidCompressedArtifacts,
    matched_compressed_message_sets: matchedCompressedMessageSets,
    issues: [...readinessIssues, ...qualityIssues]
  };
}

function normalizeResult(value: unknown): ValidationResult | undefined {
  if (!isRecord(value)
      || typeof value.sample !== "string"
      || value.sample.trim().length === 0
      || !isSource(value.source)
      || typeof value.input_sha256_before !== "string"
      || !SHA256.test(value.input_sha256_before)
      || typeof value.input_sha256_after !== "string"
      || !SHA256.test(value.input_sha256_after)
      || typeof value.input_unchanged !== "boolean"
      || value.input_unchanged !== (value.input_sha256_before === value.input_sha256_after)
      || !isRecord(value.analyze)
      || typeof value.analyze.ok !== "boolean"
      || !isRecord(value.report)
      || typeof value.report.ok !== "boolean"
      || !isRecord(value.compress)
      || typeof value.compress.ok !== "boolean") {
    return undefined;
  }

  const analyzeOk = value.analyze.ok;
  const reportOk = value.report.ok;
  let inputSha256BindingPresent = false;
  if (value.input_sha256_bound !== undefined) {
    if (value.input_sha256_bound !== true) return undefined;
    inputSha256BindingPresent = true;
  }
  let analyzeReportEvidencePresent = false;
  let analyzeReportStatus: ValidationResult["analyzeReportStatus"];
  let analyzeSemanticSha256: string | undefined;
  if (value.analyze_report !== undefined) {
    if (!isRecord(value.analyze_report)
        || !isAnalyzeReportStatus(value.analyze_report.status)) {
      return undefined;
    }
    analyzeReportEvidencePresent = true;
    analyzeReportStatus = value.analyze_report.status;
    if (analyzeReportStatus === "matched" || analyzeReportStatus === "mismatch") {
      if (!analyzeOk
          || !reportOk
          || typeof value.analyze_report.analyze_semantic_sha256 !== "string"
          || !SHA256.test(value.analyze_report.analyze_semantic_sha256)) {
        return undefined;
      }
      analyzeSemanticSha256 = value.analyze_report.analyze_semantic_sha256;
    } else if ((analyzeOk && reportOk)
        || value.analyze_report.analyze_semantic_sha256 !== undefined) {
      return undefined;
    }
  }

  let reportId: string | undefined;
  let reportSha256: string | undefined;
  if (reportOk) {
    if (typeof value.report.report_file !== "string"
        || !value.report.report_file.endsWith(".report.json")
        || typeof value.report.report_sha256 !== "string"
        || !SHA256.test(value.report.report_sha256)) {
      return undefined;
    }
    reportId = basename(value.report.report_file, ".report.json");
    if (!reportId) return undefined;
    reportSha256 = value.report.report_sha256;
  }

  let compressedId: string | undefined;
  let compressedSha256: string | undefined;
  if (value.compress.ok) {
    if (typeof value.compress.output_file !== "string"
        || !value.compress.output_file.endsWith(".trimmed.jsonl")) {
      return undefined;
    }
    compressedId = basename(value.compress.output_file, ".trimmed.jsonl");
    if (!compressedId) return undefined;
    if (value.compress.output_sha256 !== undefined) {
      if (typeof value.compress.output_sha256 !== "string"
          || !SHA256.test(value.compress.output_sha256)) {
        return undefined;
      }
      compressedSha256 = value.compress.output_sha256;
    }
  }

  return {
    sample: value.sample,
    source: value.source,
    analyzeOk: value.analyze.ok,
    reportOk,
    compressOk: value.compress.ok,
    inputSha256BindingPresent,
    inputUnchanged: value.input_unchanged,
    analyzeReportEvidencePresent,
    analyzeReportStatus,
    analyzeSemanticSha256,
    reportId,
    reportSha256,
    compressedId,
    compressedSha256
  };
}

function aggregateMatches(
  aggregate: Record<string, unknown>,
  counts: {
    analyzeOk: number;
    analyzeReportMatched: number;
    inputSha256Bound: number;
    reportOk: number;
    compressOk: number;
    inputUnchanged: number;
    failedSamples: string[];
  }
): boolean {
  const analyzeReportAggregateMatches = aggregate.analyze_report_matched === undefined
    || (Number.isInteger(aggregate.analyze_report_matched)
      && aggregate.analyze_report_matched === counts.analyzeReportMatched);
  const inputSha256AggregateMatches = aggregate.input_sha256_bound === undefined
    || (Number.isInteger(aggregate.input_sha256_bound)
      && aggregate.input_sha256_bound === counts.inputSha256Bound);
  return aggregate.analyze_ok === counts.analyzeOk
    && analyzeReportAggregateMatches
    && inputSha256AggregateMatches
    && aggregate.report_ok === counts.reportOk
    && aggregate.compress_ok === counts.compressOk
    && aggregate.input_unchanged === counts.inputUnchanged
    && Array.isArray(aggregate.failed_samples)
    && aggregate.failed_samples.every((sample) => typeof sample === "string")
    && arraysEqual(aggregate.failed_samples, counts.failedSamples);
}

function emptyEvidence(available: boolean, issue: string): ValidationEvidence {
  return {
    available,
    ready: false,
    passed: false,
    sample_count: 0,
    source_counts: emptySourceCounts(),
    analyze_success_rate: null,
    report_success_rate: null,
    compress_success_rate: null,
    input_sha256_bound: 0,
    input_unchanged: 0,
    expected_analyze_report_pairs: 0,
    matched_analyze_report_semantics: 0,
    expected_reports: 0,
    matched_reports: 0,
    matched_report_hashes: 0,
    matched_report_sources: 0,
    matched_report_inputs: 0,
    expected_compressed_artifacts: 0,
    matched_compressed_artifacts: 0,
    matched_compressed_hashes: 0,
    structurally_valid_compressed_artifacts: 0,
    matched_compressed_message_sets: 0,
    issues: [issue]
  };
}

function emptySourceCounts(): Record<Phase0ReportSource, number> {
  return {
    "claude-code-jsonl": 0,
    "openai-jsonl": 0,
    "codex-jsonl": 0
  };
}

function isSource(value: unknown): value is Phase0ReportSource {
  return typeof value === "string" && SOURCES.includes(value as Phase0ReportSource);
}

function isAnalyzeReportStatus(value: unknown): value is "matched" | "mismatch" | "unavailable" {
  return value === "matched" || value === "mismatch" || value === "unavailable";
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sourceName(source: Phase0ReportSource): "claude" | "openai" | "codex" {
  if (source === "claude-code-jsonl") return "claude";
  if (source === "openai-jsonl") return "openai";
  return "codex";
}

function ratio(value: number, total: number): number | null {
  return total === 0 ? null : Number((value / total).toFixed(4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}
