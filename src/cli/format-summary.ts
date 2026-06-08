import type { AnalysisReport } from "../types/report.js";

export function formatAnalysisSummary(report: AnalysisReport): string {
  const summary = report.summary;
  const lines = [
    "trimctx analysis",
    "",
    `messages: ${formatNumber(summary.total_messages)}`,
    `tokens: ${formatNumber(summary.total_tokens)}`,
    `protected: ${formatNumber(summary.protected_messages)}`,
    `remove candidates: ${formatNumber(summary.remove_candidates)}`,
    `compress candidates: ${formatNumber(summary.compress_candidates)}`,
    `estimated saving: ${formatNumber(summary.estimated_saving_tokens)} tokens (${formatRatio(summary.estimated_saving_ratio)})`,
    "",
    "top reasons:",
    ...formatTopReasons(report),
    "",
    "next:",
    `- trimctx report ${quotePath(report.input.file)} -o report.json`,
    `- trimctx analyze ${quotePath(report.input.file)} --json`,
    `- trimctx compress ${quotePath(report.input.file)} -o output.jsonl`
  ];

  return `${lines.join("\n")}\n`;
}

function formatTopReasons(report: AnalysisReport): string[] {
  if (report.summary.top_reasons.length === 0) {
    return ["- none: 0"];
  }

  return report.summary.top_reasons.map((item) => `- ${item.reason}: ${formatNumber(item.count)}`);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
