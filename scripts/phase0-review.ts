#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  loadPhase0ValidationEvidence,
  PHASE0_VALIDATION_GATES,
  type Phase0CompressedArtifact,
  type Phase0ReportArtifact,
  type ValidationEvidence
} from "./phase0-evidence.js";
import { validatePhase0CompressedArtifact } from "./phase0-compressed-validation.js";
import { createPhase0ReportSemanticSha256 } from "./phase0-report-semantics.js";
import { formatCliError } from "../src/cli/format-error.js";
import { writePhase0ReviewArtifacts } from "./phase0-review-output.js";

interface CliOptions {
  reports: string;
  labels: string;
  out: string;
}

type Decision = "keep" | "keep_protected" | "compress_candidate" | "remove_candidate";
type ReviewLabel =
  | "safe_remove"
  | "questionable_remove"
  | "critical_keep"
  | "protected_keep"
  | "over_protected"
  | "missed_low_value_noise"
  | "needs_summary"
  | "unclear";
type TrustStatus = "locked" | "failed" | "review_required";

interface ReportMessage {
  id?: unknown;
  decision?: unknown;
  protected?: unknown;
  reasons?: unknown;
  rot_score?: unknown;
}

interface LoadedReport {
  schemaVersion?: unknown;
  messages: unknown[];
}

interface LabelRecord {
  sample_id?: unknown;
  message_id?: unknown;
  source?: unknown;
  source_line?: unknown;
  decision?: unknown;
  rot_score?: unknown;
  label?: unknown;
  review_note?: unknown;
}

interface NormalizedLabel {
  sample_id: string;
  message_id: string;
  decision?: Decision;
  label: ReviewLabel;
  has_review_note: boolean;
}

const GATES = {
  critical_false_deletion: 0,
  protected_recall: 1,
  remove_candidate_precision: 0.7,
  protected_sample_coverage: 0.2,
  critical_protected_rot_score: 0.6
} as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const reportsDir = resolve(options.reports);
  const labelsDir = resolve(options.labels);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });

  const {
    messages: reports,
    artifacts: reportArtifacts,
    compressedArtifacts
  } = await loadReports(reportsDir);
  const labels = await loadLabels(labelsDir);
  const validation = await loadPhase0ValidationEvidence(
    reportsDir,
    reportArtifacts,
    compressedArtifacts
  );
  const metrics = summarize(reports, labels);
  const gates = evaluateGates(metrics, validation);
  const output = {
    schema_version: "trimctx.phase0.review.v2",
    generated_at: new Date().toISOString(),
    report_count: reports.size,
    label_count: labels.length,
    gates: { ...GATES, validation: PHASE0_VALIDATION_GATES },
    validation,
    metrics,
    gates_passed: gates.passed,
    trust_status: gates.status,
    notes: [
      "Manual review metrics are computed from labels only; raw message content and review notes are intentionally excluded.",
      "Phase 0 trust is locked only when batch validation evidence and manual review gates both pass.",
      "Batch evidence output contains aggregate counts and fixed issue codes only; private paths and command errors are excluded."
    ]
  };

  await writePhase0ReviewArtifacts(
    outDir,
    `${JSON.stringify(output, null, 2)}\n`,
    formatSummary(output)
  );
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: Partial<CliOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--reports") {
      options.reports = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--labels") {
      options.labels = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.reports || !options.labels || !options.out) {
    printUsage(1);
  }
  return { reports: options.reports, labels: options.labels, out: options.out };
}

function printUsage(exitCode: number): never {
  const usage = [
    "Usage: npx tsx scripts/phase0-review.ts --reports <reports-dir> --labels <labels-dir> --out <out-dir>",
    "",
    "Computes Phase 0 manual review metrics from trimctx report JSON files and reviewer labels.",
    "Label JSONL fields: sample_id, message_id, decision, label, review_note."
  ].join("\n");
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${usage}\n`);
  process.exit(exitCode);
}

async function loadReports(dir: string): Promise<{
  messages: Map<string, LoadedReport>;
  artifacts: Map<string, Phase0ReportArtifact>;
  compressedArtifacts: Map<string, Phase0CompressedArtifact>;
}> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".report.json"))
    .map((entry) => join(dir, entry.name))
    .sort();
  if (files.length === 0) {
    throw new Error(`No *.report.json files found in ${dir}`);
  }

  const reports = new Map<string, LoadedReport>();
  const artifacts = new Map<string, Phase0ReportArtifact>();
  const compressedArtifacts = new Map<string, Phase0CompressedArtifact>();
  for (const file of files) {
    const content = await readFile(file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString("utf8")) as unknown;
    } catch {
      throw new Error(`Invalid report JSON: ${file}`);
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
      throw new Error(`Report is missing messages array: ${file}`);
    }
    const sampleId = sampleIdFromReportFile(file);
    reports.set(sampleId, {
      schemaVersion: parsed.schema_version,
      messages: parsed.messages
    });
    artifacts.set(sampleId, {
      sha256: createHash("sha256").update(content).digest("hex"),
      semanticSha256: createPhase0ReportSemanticSha256(parsed),
      source: isRecord(parsed.input) ? parsed.input.source : undefined,
      inputFile: isRecord(parsed.input) ? parsed.input.file : undefined,
      messages: parsed.messages
    });
  }
  const compressedFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".trimmed.jsonl"))
    .map((entry) => join(dir, entry.name))
    .sort();
  for (const file of compressedFiles) {
    try {
      const content = await readFile(file);
      const sampleId = basename(file, ".trimmed.jsonl");
      const report = artifacts.get(sampleId);
      compressedArtifacts.set(sampleId, {
        sha256: createHash("sha256").update(content).digest("hex"),
        validation: validatePhase0CompressedArtifact(
          content,
          file,
          report?.source,
          report?.messages ?? []
        )
      });
    } catch {
      // Unusable artifacts stay out of the aggregate-only evidence map.
    }
  }
  return { messages: reports, artifacts, compressedArtifacts };
}

async function loadLabels(dir: string): Promise<NormalizedLabel[]> {
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(dir, entry.name))
    .sort();
  if (files.length === 0) {
    throw new Error(`No label .jsonl files found in ${dir}`);
  }

  const labels: NormalizedLabel[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Invalid label JSON at ${file}:${index + 1}`);
      }
      if (!isRecord(parsed)) {
        throw new Error(`Invalid label record at ${file}:${index + 1}`);
      }
      labels.push(normalizeLabel(parsed, file, index + 1));
    }
  }
  return labels;
}

function sampleIdFromReportFile(file: string): string {
  return basename(file).replace(/\.report\.json$/, "");
}

function normalizeLabel(record: LabelRecord, file: string, line: number): NormalizedLabel {
  const sampleId = stringField(record.sample_id);
  const messageId = stringField(record.message_id);
  const label = normalizeReviewLabel(stringField(record.label));
  const decision = optionalDecision(record.decision);
  const hasReviewNote = stringField(record.review_note) !== undefined;
  if (!sampleId || !messageId || !label) {
    throw new Error(`Invalid label at ${file}:${line}`);
  }
  return {
    sample_id: sampleId,
    message_id: messageId,
    decision,
    label,
    has_review_note: hasReviewNote
  };
}

function summarize(reports: Map<string, LoadedReport>, labels: NormalizedLabel[]) {
  const reportQuality = validateReports(reports);
  const labelQuality = validateLabels(reports, labels);
  const labelsByKey = groupLabelsByKey(labels);
  let removeCandidates = 0;
  let removeCandidatesReviewed = 0;
  let safeRemove = 0;
  let questionableRemove = 0;
  let criticalFalseDeletion = 0;
  let protectedMessages = 0;
  let protectedReviewed = 0;
  let protectedKeep = 0;
  let criticalProtectedMessages = 0;
  let criticalProtectedReviewed = 0;
  let nonCriticalProtectedMessages = 0;
  let nonCriticalProtectedReviewed = 0;
  let overProtected = 0;
  let missedLowValueNoise = 0;
  let needsSummary = 0;
  let unclear = 0;

  for (const [sampleId, report] of reports.entries()) {
    for (const message of report.messages) {
      if (!isReportMessage(message)) continue;
      const id = stringField(message.id);
      if (!id) continue;
      const decision = optionalDecision(message.decision);
      const isProtected = message.protected === true || decision === "keep_protected";
      const messageLabels = labelsByKey.get(messageKey(sampleId, id)) ?? [];
      const metricLabel = metricLabelForMessage(messageLabels, message);

      if (decision === "remove_candidate") {
        removeCandidates += 1;
        if (hasCriticalFalseDeletionLabel(messageLabels, message)) {
          criticalFalseDeletion += 1;
        }
        if (metricLabel && isRemoveCandidateReviewLabel(metricLabel.label)) {
          removeCandidatesReviewed += 1;
          if (metricLabel.label === "safe_remove") safeRemove += 1;
          if (metricLabel.label === "questionable_remove") questionableRemove += 1;
        }
      }

      if (isProtected) {
        const isCriticalProtected = hasCriticalProtectedReason(message);
        protectedMessages += 1;
        if (isCriticalProtected) {
          criticalProtectedMessages += 1;
        } else {
          nonCriticalProtectedMessages += 1;
        }
        if (metricLabel && isProtectedReviewLabel(metricLabel.label)) {
          protectedReviewed += 1;
          if (isCriticalProtected) {
            criticalProtectedReviewed += 1;
          } else {
            nonCriticalProtectedReviewed += 1;
          }
          if (metricLabel.label === "protected_keep") protectedKeep += 1;
          if (metricLabel.label === "over_protected") overProtected += 1;
        }
      }

      if (metricLabel?.label === "missed_low_value_noise") missedLowValueNoise += 1;
      if (metricLabel?.label === "needs_summary") needsSummary += 1;
      if (metricLabel?.label === "unclear") unclear += 1;
    }
  }

  const protectedSampleCoverage = nonCriticalProtectedMessages === 0
    ? 1
    : roundRatio(nonCriticalProtectedReviewed / nonCriticalProtectedMessages);
  const protectedReviewRequirementMet = criticalProtectedReviewed === criticalProtectedMessages
    && protectedSampleCoverage >= GATES.protected_sample_coverage;

  return {
    remove_candidates: removeCandidates,
    remove_candidates_reviewed: removeCandidatesReviewed,
    safe_remove: safeRemove,
    questionable_remove: questionableRemove,
    critical_false_deletion: criticalFalseDeletion,
    remove_candidate_precision: removeCandidatesReviewed === 0 ? null : roundRatio(safeRemove / removeCandidatesReviewed),
    protected_messages: protectedMessages,
    protected_reviewed: protectedReviewed,
    protected_keep: protectedKeep,
    protected_recall: protectedReviewed === 0 ? null : roundRatio(protectedKeep / protectedReviewed),
    critical_protected_messages: criticalProtectedMessages,
    critical_protected_reviewed: criticalProtectedReviewed,
    non_critical_protected_messages: nonCriticalProtectedMessages,
    non_critical_protected_reviewed: nonCriticalProtectedReviewed,
    protected_sample_coverage: protectedSampleCoverage,
    protected_review_requirement_met: protectedReviewRequirementMet,
    over_protected: overProtected,
    missed_low_value_noise: missedLowValueNoise,
    needs_summary: needsSummary,
    unclear,
    ...reportQuality,
    ...labelQuality
  };
}

function hasCriticalProtectedReason(message: ReportMessage): boolean {
  return typeof message.rot_score === "number" && message.rot_score >= GATES.critical_protected_rot_score;
}

function validateReports(reports: Map<string, LoadedReport>) {
  let invalidReportSchemas = 0;
  let invalidMessageRecords = 0;
  let missingMessageIds = 0;
  let duplicateMessageIds = 0;
  let invalidMessageDecisions = 0;
  let invalidProtectedFlags = 0;
  let invalidRotScores = 0;
  let inconsistentProtectionDecisions = 0;
  let missingCandidateReasons = 0;

  for (const report of reports.values()) {
    if (report.schemaVersion !== "trimctx.report.v2") {
      invalidReportSchemas += 1;
    }
    const seenIds = new Set<string>();
    for (const message of report.messages) {
      if (!isReportMessage(message)) {
        invalidMessageRecords += 1;
        continue;
      }

      const id = stringField(message.id);
      if (!id) {
        missingMessageIds += 1;
      } else if (seenIds.has(id)) {
        duplicateMessageIds += 1;
      } else {
        seenIds.add(id);
      }

      const decision = optionalDecision(message.decision);
      const hasValidDecision = decision !== undefined;
      const hasValidProtected = typeof message.protected === "boolean";
      if (!hasValidDecision) invalidMessageDecisions += 1;
      if (!hasValidProtected) invalidProtectedFlags += 1;
      if (typeof message.rot_score !== "number" || !Number.isFinite(message.rot_score)) {
        invalidRotScores += 1;
      }
      if ((decision === "remove_candidate" || decision === "compress_candidate")
          && (!Array.isArray(message.reasons) || message.reasons.length === 0)) {
        missingCandidateReasons += 1;
      }
      if (hasValidDecision
          && hasValidProtected
          && (decision === "keep_protected") !== message.protected) {
        inconsistentProtectionDecisions += 1;
      }
    }
  }

  const reportQualityIssues = invalidMessageRecords
    + invalidReportSchemas
    + missingMessageIds
    + duplicateMessageIds
    + invalidMessageDecisions
    + invalidProtectedFlags
    + invalidRotScores
    + inconsistentProtectionDecisions
    + missingCandidateReasons;
  return {
    report_quality_issues: reportQualityIssues,
    invalid_report_schemas: invalidReportSchemas,
    invalid_message_records: invalidMessageRecords,
    missing_message_ids: missingMessageIds,
    duplicate_message_ids: duplicateMessageIds,
    invalid_message_decisions: invalidMessageDecisions,
    invalid_protected_flags: invalidProtectedFlags,
    invalid_rot_scores: invalidRotScores,
    inconsistent_protection_decisions: inconsistentProtectionDecisions,
    missing_candidate_reasons: missingCandidateReasons
  };
}

function validateLabels(reports: Map<string, LoadedReport>, labels: NormalizedLabel[]) {
  const messageByKey = new Map<string, ReportMessage>();
  for (const [sampleId, report] of reports.entries()) {
    for (const message of report.messages) {
      if (!isReportMessage(message)) continue;
      const id = stringField(message.id);
      const key = id ? messageKey(sampleId, id) : undefined;
      if (key && !messageByKey.has(key)) messageByKey.set(key, message);
    }
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let unknownReferences = 0;
  let decisionMismatches = 0;
  let invalidLabelDecisions = 0;
  let missingReviewNotes = 0;
  let incompatibleLabelCategories = 0;

  for (const label of labels) {
    if (label.decision === undefined) invalidLabelDecisions += 1;
    if (!label.has_review_note) missingReviewNotes += 1;
    const key = messageKey(label.sample_id, label.message_id);
    const message = messageByKey.get(key);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
    if (!message) {
      unknownReferences += 1;
      continue;
    }
    const reportDecision = optionalDecision(message.decision);
    if (label.decision && reportDecision && label.decision !== reportDecision) {
      decisionMismatches += 1;
    }
    if (!isLabelCompatibleWithReportMessage(label.label, message)) {
      incompatibleLabelCategories += 1;
    }
  }

  const duplicateLabels = duplicates.size;
  return {
    label_quality_issues: unknownReferences
      + duplicateLabels
      + decisionMismatches
      + invalidLabelDecisions
      + missingReviewNotes
      + incompatibleLabelCategories,
    unknown_label_references: unknownReferences,
    duplicate_labels: duplicateLabels,
    decision_mismatches: decisionMismatches,
    invalid_label_decisions: invalidLabelDecisions,
    missing_review_notes: missingReviewNotes,
    incompatible_label_categories: incompatibleLabelCategories
  };
}

function evaluateGates(
  metrics: ReturnType<typeof summarize>,
  validation: ValidationEvidence
): { passed: boolean; status: TrustStatus } {
  if (!validation.ready) {
    return { passed: false, status: "review_required" };
  }
  if (!validation.passed) {
    return { passed: false, status: "failed" };
  }
  const reviewComplete = metrics.remove_candidates_reviewed === metrics.remove_candidates && metrics.protected_review_requirement_met;
  if (metrics.report_quality_issues > 0
      || metrics.label_quality_issues > 0
      || !reviewComplete
      || metrics.remove_candidate_precision === null
      || metrics.protected_recall === null) {
    return { passed: false, status: "review_required" };
  }
  const passed = metrics.critical_false_deletion === GATES.critical_false_deletion
    && metrics.protected_recall >= GATES.protected_recall
    && metrics.remove_candidate_precision >= GATES.remove_candidate_precision;
  return { passed, status: passed ? "locked" : "failed" };
}

function formatSummary(output: {
  generated_at: string;
  report_count: number;
  label_count: number;
  gates_passed: boolean;
  trust_status: TrustStatus;
  validation: ValidationEvidence;
  metrics: ReturnType<typeof summarize>;
}): string {
  const rows = [
    ["Critical false deletion", String(output.metrics.critical_false_deletion), String(GATES.critical_false_deletion), passFail(output.metrics.critical_false_deletion === GATES.critical_false_deletion)],
    ["Protected recall", percent(output.metrics.protected_recall), percent(GATES.protected_recall), passFail(output.metrics.protected_recall !== null && output.metrics.protected_recall >= GATES.protected_recall)],
    ["Remove candidate precision", percent(output.metrics.remove_candidate_precision), percent(GATES.remove_candidate_precision), passFail(output.metrics.remove_candidate_precision !== null && output.metrics.remove_candidate_precision >= GATES.remove_candidate_precision)]
  ];

  const lines: string[] = [];
  lines.push("# Phase 0 Manual Review");
  lines.push("");
  lines.push(`Generated at: ${output.generated_at}`);
  lines.push(`Trust status: ${output.trust_status}`);
  lines.push(`Gates passed: ${output.gates_passed ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Inputs");
  lines.push("| Input | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Reports | ${output.report_count} |`);
  lines.push(`| Labels | ${output.label_count} |`);
  lines.push("");
  lines.push("## Validation Evidence");
  lines.push("| Metric | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Evidence file available | ${output.validation.available ? "yes" : "no"} |`);
  lines.push(`| Ready | ${output.validation.ready ? "yes" : "no"} |`);
  lines.push(`| Passed | ${output.validation.passed ? "yes" : "no"} |`);
  lines.push(`| Samples | ${output.validation.sample_count} |`);
  lines.push(`| Claude samples | ${output.validation.source_counts["claude-code-jsonl"]} |`);
  lines.push(`| OpenAI samples | ${output.validation.source_counts["openai-jsonl"]} |`);
  lines.push(`| Codex samples | ${output.validation.source_counts["codex-jsonl"]} |`);
  lines.push(`| Analyze success rate | ${percent(output.validation.analyze_success_rate)} |`);
  lines.push(`| Report success rate | ${percent(output.validation.report_success_rate)} |`);
  lines.push(`| Compress success rate | ${percent(output.validation.compress_success_rate)} |`);
  lines.push(`| Command inputs SHA-256 bound | ${output.validation.input_sha256_bound}/${output.validation.sample_count} |`);
  lines.push(`| Input unchanged | ${output.validation.input_unchanged}/${output.validation.sample_count} |`);
  lines.push(`| Expected analyze/report pairs | ${output.validation.expected_analyze_report_pairs} |`);
  lines.push(`| Analyze/report semantics matched | ${output.validation.matched_analyze_report_semantics}/${output.validation.expected_analyze_report_pairs} |`);
  lines.push(`| Reports matched | ${output.validation.matched_reports}/${output.validation.expected_reports} |`);
  lines.push(`| Report hashes matched | ${output.validation.matched_report_hashes}/${output.validation.expected_reports} |`);
  lines.push(`| Report sources matched | ${output.validation.matched_report_sources}/${output.validation.expected_reports} |`);
  lines.push(`| Report inputs matched | ${output.validation.matched_report_inputs}/${output.validation.expected_reports} |`);
  lines.push(`| Compressed artifacts matched | ${output.validation.matched_compressed_artifacts}/${output.validation.expected_compressed_artifacts} |`);
  lines.push(`| Compressed hashes matched | ${output.validation.matched_compressed_hashes}/${output.validation.expected_compressed_artifacts} |`);
  lines.push(`| Compressed structures valid | ${output.validation.structurally_valid_compressed_artifacts}/${output.validation.expected_compressed_artifacts} |`);
  lines.push(`| Compressed message sets matched | ${output.validation.matched_compressed_message_sets}/${output.validation.expected_compressed_artifacts} |`);
  lines.push(`| Issues | ${output.validation.issues.join(", ") || "none"} |`);
  lines.push("");
  lines.push("## Gates");
  lines.push("| Metric | Actual | Gate | Status |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const row of rows) {
    lines.push(`| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} |`);
  }
  lines.push("");
  lines.push("## Review Counts");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Remove candidates | ${output.metrics.remove_candidates} |`);
  lines.push(`| Remove candidates reviewed | ${output.metrics.remove_candidates_reviewed} |`);
  lines.push(`| Safe remove | ${output.metrics.safe_remove} |`);
  lines.push(`| Questionable remove | ${output.metrics.questionable_remove} |`);
  lines.push(`| Protected messages | ${output.metrics.protected_messages} |`);
  lines.push(`| Protected reviewed | ${output.metrics.protected_reviewed} |`);
  lines.push(`| Critical protected messages | ${output.metrics.critical_protected_messages} |`);
  lines.push(`| Critical protected reviewed | ${output.metrics.critical_protected_reviewed} |`);
  lines.push(`| Non-critical protected messages | ${output.metrics.non_critical_protected_messages} |`);
  lines.push(`| Non-critical protected reviewed | ${output.metrics.non_critical_protected_reviewed} |`);
  lines.push(`| Protected sample coverage | ${percent(output.metrics.protected_sample_coverage)} |`);
  lines.push(`| Protected review requirement met | ${output.metrics.protected_review_requirement_met ? "yes" : "no"} |`);
  lines.push(`| Over protected | ${output.metrics.over_protected} |`);
  lines.push(`| Missed low-value noise | ${output.metrics.missed_low_value_noise} |`);
  lines.push(`| Needs summary | ${output.metrics.needs_summary} |`);
  lines.push(`| Unclear | ${output.metrics.unclear} |`);
  lines.push("");
  lines.push("## Report Quality");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Report quality issues | ${output.metrics.report_quality_issues} |`);
  lines.push(`| Invalid report schemas | ${output.metrics.invalid_report_schemas} |`);
  lines.push(`| Invalid message records | ${output.metrics.invalid_message_records} |`);
  lines.push(`| Missing message IDs | ${output.metrics.missing_message_ids} |`);
  lines.push(`| Duplicate message IDs | ${output.metrics.duplicate_message_ids} |`);
  lines.push(`| Invalid message decisions | ${output.metrics.invalid_message_decisions} |`);
  lines.push(`| Invalid protected flags | ${output.metrics.invalid_protected_flags} |`);
  lines.push(`| Invalid rot scores | ${output.metrics.invalid_rot_scores} |`);
  lines.push(`| Inconsistent protection decisions | ${output.metrics.inconsistent_protection_decisions} |`);
  lines.push(`| Missing candidate reasons | ${output.metrics.missing_candidate_reasons} |`);
  lines.push("");
  lines.push("## Label Quality");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Label quality issues | ${output.metrics.label_quality_issues} |`);
  lines.push(`| Unknown label references | ${output.metrics.unknown_label_references} |`);
  lines.push(`| Duplicate labels | ${output.metrics.duplicate_labels} |`);
  lines.push(`| Decision mismatches | ${output.metrics.decision_mismatches} |`);
  lines.push(`| Invalid label decisions | ${output.metrics.invalid_label_decisions} |`);
  lines.push(`| Missing review notes | ${output.metrics.missing_review_notes} |`);
  lines.push(`| Incompatible label categories | ${output.metrics.incompatible_label_categories} |`);
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("- Raw message content and reviewer notes are intentionally excluded from this summary.");
  lines.push("- Batch validation evidence exposes aggregate counts and fixed issue codes only; private paths, stderr, and command errors are excluded.");
  lines.push("- Phase 0 remains review-required until batch coverage is ready, all remove candidates are labeled, and protected review covers all critical protected messages plus a sampled subset of other protected messages.");
  return `${lines.join("\n")}\n`;
}

function messageKey(sampleId: string, messageId: string): string {
  return `${sampleId}\u0000${messageId}`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalDecision(value: unknown): Decision | undefined {
  return typeof value === "string" && ["keep", "keep_protected", "compress_candidate", "remove_candidate"].includes(value)
    ? value as Decision
    : undefined;
}

function isReviewLabel(value: string | undefined): value is ReviewLabel {
  return value !== undefined && [
    "safe_remove",
    "questionable_remove",
    "critical_keep",
    "protected_keep",
    "over_protected",
    "missed_low_value_noise",
    "needs_summary",
    "unclear"
  ].includes(value);
}

function normalizeReviewLabel(value: string | undefined): ReviewLabel | undefined {
  if (value === "critical_false_delete") return "critical_keep";
  return isReviewLabel(value) ? value : undefined;
}

function groupLabelsByKey(labels: NormalizedLabel[]): Map<string, NormalizedLabel[]> {
  const labelsByKey = new Map<string, NormalizedLabel[]>();
  for (const label of labels) {
    const key = messageKey(label.sample_id, label.message_id);
    const existing = labelsByKey.get(key);
    if (existing) {
      existing.push(label);
    } else {
      labelsByKey.set(key, [label]);
    }
  }
  return labelsByKey;
}

function metricLabelForMessage(labels: NormalizedLabel[], message: ReportMessage): NormalizedLabel | undefined {
  if (labels.length !== 1) return undefined;
  const [label] = labels;
  return isLabelUsableForMetrics(label, message) ? label : undefined;
}

function isLabelUsableForMetrics(label: NormalizedLabel, message: ReportMessage): boolean {
  const reportDecision = optionalDecision(message.decision);
  return label.decision !== undefined
    && reportDecision !== undefined
    && label.decision === reportDecision
    && label.has_review_note
    && isLabelCompatibleWithReportMessage(label.label, message);
}

function hasCriticalFalseDeletionLabel(labels: NormalizedLabel[], message: ReportMessage): boolean {
  return labels.some((label) =>
    label.label === "critical_keep" && isLabelCompatibleWithReportMessage(label.label, message)
  );
}

function isRemoveCandidateReviewLabel(label: ReviewLabel): boolean {
  return label === "safe_remove" || label === "questionable_remove" || label === "critical_keep";
}

function isProtectedReviewLabel(label: ReviewLabel): boolean {
  return label === "protected_keep" || label === "over_protected";
}

function isLabelCompatibleWithReportMessage(label: ReviewLabel, message: ReportMessage): boolean {
  const decision = optionalDecision(message.decision);
  if (!decision) return true;
  const isProtected = message.protected === true || decision === "keep_protected";
  if (isRemoveCandidateReviewLabel(label)) {
    return decision === "remove_candidate";
  }
  if (isProtectedReviewLabel(label)) {
    return isProtected;
  }
  if (label === "needs_summary") {
    return decision !== "remove_candidate";
  }
  if (label === "unclear") {
    return true;
  }
  return !isProtected && decision !== "remove_candidate";
}

function isReportMessage(value: unknown): value is ReportMessage {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundRatio(value: number): number {
  return Number(value.toFixed(4));
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function passFail(passed: boolean): "PASS" | "FAIL" {
  return passed ? "PASS" : "FAIL";
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
});
