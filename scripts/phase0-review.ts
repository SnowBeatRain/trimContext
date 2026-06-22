#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

interface CliOptions {
  reports: string;
  labels: string;
  out: string;
}

type Decision = "keep" | "keep_protected" | "compress_candidate" | "remove_candidate";
type ReviewLabel = "safe_remove" | "questionable_remove" | "critical_keep" | "protected_keep" | "over_protected" | "missed_low_value_noise";
type TrustStatus = "locked" | "failed" | "review_required";

interface ReportMessage {
  id?: unknown;
  decision?: unknown;
  protected?: unknown;
}

interface ReportFile {
  messages?: ReportMessage[];
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
}

const GATES = {
  critical_false_deletion: 0,
  protected_recall: 1,
  remove_candidate_precision: 0.7
} as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const reportsDir = resolve(options.reports);
  const labelsDir = resolve(options.labels);
  const outDir = resolve(options.out);
  await mkdir(outDir, { recursive: true });

  const reports = await loadReports(reportsDir);
  const labels = await loadLabels(labelsDir);
  const metrics = summarize(reports, labels);
  const gates = evaluateGates(metrics);
  const output = {
    schema_version: "trimctx.phase0.review.v1",
    generated_at: new Date().toISOString(),
    reports_dir: reportsDir,
    labels_dir: labelsDir,
    report_count: reports.size,
    label_count: labels.length,
    gates: GATES,
    metrics,
    gates_passed: gates.passed,
    trust_status: gates.status,
    notes: [
      "Manual review metrics are computed from labels only; raw message content and review notes are intentionally excluded.",
      "Phase 0 trust is locked only when all gates pass."
    ]
  };

  await writeFile(join(outDir, "phase0-review.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(join(outDir, "phase0-review.md"), formatSummary(output), "utf8");
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

async function loadReports(dir: string): Promise<Map<string, ReportMessage[]>> {
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".report.json"))
    .map((entry) => join(dir, entry.name))
    .sort();
  if (files.length === 0) {
    throw new Error(`No *.report.json files found in ${dir}`);
  }

  const reports = new Map<string, ReportMessage[]>();
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8")) as ReportFile;
    if (!Array.isArray(parsed.messages)) {
      throw new Error(`Report is missing messages array: ${file}`);
    }
    reports.set(sampleIdFromReportFile(file), parsed.messages);
  }
  return reports;
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
      const parsed = JSON.parse(line) as LabelRecord;
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
  const label = stringField(record.label);
  const decision = optionalDecision(record.decision);
  if (!sampleId || !messageId || !isReviewLabel(label)) {
    throw new Error(`Invalid label at ${file}:${line}`);
  }
  return { sample_id: sampleId, message_id: messageId, decision, label };
}

function summarize(reports: Map<string, ReportMessage[]>, labels: NormalizedLabel[]) {
  const quality = validateLabels(reports, labels);
  const labelByKey = new Map(labels.map((label) => [messageKey(label.sample_id, label.message_id), label]));
  let removeCandidates = 0;
  let removeCandidatesReviewed = 0;
  let safeRemove = 0;
  let questionableRemove = 0;
  let criticalFalseDeletion = 0;
  let protectedMessages = 0;
  let protectedReviewed = 0;
  let protectedKeep = 0;
  let overProtected = 0;
  let missedLowValueNoise = 0;

  for (const [sampleId, messages] of reports.entries()) {
    for (const message of messages) {
      const id = stringField(message.id);
      if (!id) continue;
      const decision = optionalDecision(message.decision);
      const isProtected = message.protected === true || decision === "keep_protected";
      const label = labelByKey.get(messageKey(sampleId, id));

      if (decision === "remove_candidate") {
        removeCandidates += 1;
        if (label) {
          removeCandidatesReviewed += 1;
          if (label.label === "safe_remove") safeRemove += 1;
          if (label.label === "questionable_remove") questionableRemove += 1;
          if (label.label === "critical_keep") criticalFalseDeletion += 1;
        }
      }

      if (isProtected) {
        protectedMessages += 1;
        if (label) {
          protectedReviewed += 1;
          if (label.label === "protected_keep") protectedKeep += 1;
          if (label.label === "over_protected") overProtected += 1;
        }
      }
    }
  }

  for (const label of labels) {
    if (label.label === "missed_low_value_noise") missedLowValueNoise += 1;
  }

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
    over_protected: overProtected,
    missed_low_value_noise: missedLowValueNoise,
    ...quality
  };
}

function validateLabels(reports: Map<string, ReportMessage[]>, labels: NormalizedLabel[]) {
  const messageByKey = new Map<string, ReportMessage>();
  for (const [sampleId, messages] of reports.entries()) {
    for (const message of messages) {
      const id = stringField(message.id);
      if (id) messageByKey.set(messageKey(sampleId, id), message);
    }
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let unknownReferences = 0;
  let decisionMismatches = 0;

  for (const label of labels) {
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
  }

  const duplicateLabels = duplicates.size;
  return {
    label_quality_issues: unknownReferences + duplicateLabels + decisionMismatches,
    unknown_label_references: unknownReferences,
    duplicate_labels: duplicateLabels,
    decision_mismatches: decisionMismatches
  };
}

function evaluateGates(metrics: ReturnType<typeof summarize>): { passed: boolean; status: TrustStatus } {
  const reviewComplete = metrics.remove_candidates_reviewed === metrics.remove_candidates && metrics.protected_reviewed === metrics.protected_messages;
  if (metrics.label_quality_issues > 0 || !reviewComplete || metrics.remove_candidate_precision === null || metrics.protected_recall === null) {
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
  lines.push(`| Over protected | ${output.metrics.over_protected} |`);
  lines.push(`| Missed low-value noise | ${output.metrics.missed_low_value_noise} |`);
  lines.push("");
  lines.push("## Label Quality");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Label quality issues | ${output.metrics.label_quality_issues} |`);
  lines.push(`| Unknown label references | ${output.metrics.unknown_label_references} |`);
  lines.push(`| Duplicate labels | ${output.metrics.duplicate_labels} |`);
  lines.push(`| Decision mismatches | ${output.metrics.decision_mismatches} |`);
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("- Raw message content and reviewer notes are intentionally excluded from this summary.");
  lines.push("- Phase 0 remains review-required until all candidates and protected messages have labels.");
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
  return value !== undefined && ["safe_remove", "questionable_remove", "critical_keep", "protected_keep", "over_protected", "missed_low_value_noise"].includes(value);
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
