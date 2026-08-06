import type { AnalysisReport } from "../types/report.js";
import {
  assessmentSummaryLabel,
  confidenceLabel,
  findingCopy,
  healthStatusLabel,
  limitationLabel,
  missingEvidenceLabel,
  recommendationSummaryLabel
} from "../core/report-copy.js";

export function formatAnalysisSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const lines = [heading("trimctx analysis", options?.color ?? false), ""];
  appendAssessment(lines, report);
  appendNext(lines, report);
  return `${lines.join("\n")}\n`;
}

export function formatUserSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const lines = [heading("trimctx 看了一下当前会话：", options?.color ?? false), ""];
  lines.push(`状态: ${healthStatusLabel(report.assessment.status)}`);
  lines.push(`置信度: ${confidenceLabel(report.assessment.confidence)}`);
  lines.push(`文件: ${report.input.file}`, "", "原因：");
  lines.push(`- ${assessmentSummaryLabel(report.assessment.summary)}`);
  appendLimitations(lines, report);
  appendFindings(lines, report);
  lines.push(`- 续接缺失: ${missingResumeEvidence(report)}`, "", "下一步：");
  appendFirstRecommendation(lines, report);
  lines.push("", "高级审计：");
  appendReportCommands(lines, report);
  lines.push("", "说明：trimctx 只做本地分析，没有上传文件。");
  return `${lines.join("\n")}\n`;
}

function appendAssessment(lines: string[], report: AnalysisReport): void {
  lines.push(`状态: ${healthStatusLabel(report.assessment.status)}`);
  lines.push(`置信度: ${confidenceLabel(report.assessment.confidence)}`);
  lines.push(`结论: ${assessmentSummaryLabel(report.assessment.summary)}`);
  if (report.assessment.status === "unknown") {
    lines.push("说明: 当前证据不足，不能把会话描述为干净或健康。");
  }
  appendLimitations(lines, report);
  lines.push("");
  appendFindings(lines, report);
  lines.push(`续接缺失: ${missingResumeEvidence(report)}`, "");
  lines.push("建议:");
  appendFirstRecommendation(lines, report);
  lines.push("");
}

function appendLimitations(lines: string[], report: AnalysisReport): void {
  for (const limitation of report.assessment.limitations) {
    lines.push(`限制: ${limitationLabel(limitation)}`);
  }
}

function appendFindings(lines: string[], report: AnalysisReport): void {
  const findings = report.findings.filter(finding => finding.type !== "limitation").slice(0, 2);
  if (findings.length === 0) {
    lines.push("发现: 没有高置信风险发现。");
    return;
  }
  for (const finding of findings) {
    const copy = findingCopy(finding);
    lines.push(`发现: ${copy.title} - ${copy.summary}`);
  }
}

function appendFirstRecommendation(lines: string[], report: AnalysisReport): void {
  const recommendation = [...report.recommendations].sort((left, right) => left.priority - right.priority)[0];
  if (!recommendation) {
    lines.push("- 暂无额外建议；继续人工审查当前证据。");
    return;
  }
  lines.push(`- ${recommendationSummaryLabel(recommendation, report.resume.readiness.missing)}`);
  if (recommendation.command) lines.push(`  ${recommendation.command}`);
}

function appendNext(lines: string[], report: AnalysisReport): void {
  lines.push("报告:");
  appendReportCommands(lines, report);
}

function appendReportCommands(lines: string[], report: AnalysisReport): void {
  lines.push(`  trimctx report ${quotePath(report.input.file)} -o report.md`);
  lines.push(`  trimctx report ${quotePath(report.input.file)} -o report.json`);
}

function missingResumeEvidence(report: AnalysisReport): string {
  return report.resume.readiness.missing.length > 0
    ? report.resume.readiness.missing.map(missingEvidenceLabel).join("、")
    : "无";
}

function heading(text: string, color: boolean): string {
  return color ? `\x1b[1m${text}\x1b[0m` : text;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
