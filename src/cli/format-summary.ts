import type { AnalysisReport } from "../types/report.js";

const LIMITATION_LABELS: Record<string, string> = {
  sample_too_short: "样本过短，证据不足。",
  protected_coverage_too_high: "protected 内容占比过高，可分析证据不足。",
  unknown_role_coverage_too_high: "未知角色内容占比过高，角色证据不足。",
  analyzable_coverage_too_low: "可分析消息占比过低，证据不足。",
  insufficient_positive_evidence: "正向证据不足，不能判定会话健康。"
};

export function formatAnalysisSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const lines = [heading("trimctx analysis", options?.color ?? false), ""];
  appendAssessment(lines, report);
  appendNext(lines, report);
  return `${lines.join("\n")}\n`;
}

export function formatUserSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const lines = [heading("trimctx 看了一下当前会话：", options?.color ?? false), ""];
  lines.push(`状态: ${report.assessment.status.toUpperCase()}`);
  lines.push(`置信度: ${report.assessment.confidence.toUpperCase()}`);
  lines.push(`文件: ${report.input.file}`, "", "原因：");
  lines.push(`- ${report.assessment.summary}`);
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
  lines.push(`状态: ${report.assessment.status.toUpperCase()}`);
  lines.push(`置信度: ${report.assessment.confidence.toUpperCase()}`);
  lines.push(`结论: ${report.assessment.summary}`);
  if (report.assessment.status === "unknown") {
    lines.push("说明: 当前证据不足，不能把会话描述为 clean 或 healthy。");
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
    lines.push(`限制: ${LIMITATION_LABELS[limitation] ?? limitation}`);
  }
}

function appendFindings(lines: string[], report: AnalysisReport): void {
  const findings = report.findings.slice(0, 2);
  if (findings.length === 0) {
    lines.push("发现: 没有高置信发现。");
    return;
  }
  for (const finding of findings) {
    lines.push(`发现: ${finding.title} - ${finding.summary}`);
  }
}

function appendFirstRecommendation(lines: string[], report: AnalysisReport): void {
  const recommendation = [...report.recommendations].sort((left, right) => left.priority - right.priority)[0];
  if (!recommendation) {
    lines.push("- 暂无额外建议；继续人工审查当前证据。");
    return;
  }
  lines.push(`- ${recommendation.summary}`);
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
    ? report.resume.readiness.missing.join(", ")
    : "none";
}

function heading(text: string, color: boolean): string {
  return color ? `\x1b[1m${text}\x1b[0m` : text;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
