import type { AnalysisReport, FindingEvidenceRef, ReviewQueueItem } from "../types/report.js";
import {
  assessmentSummaryLabel,
  confidenceLabel,
  dimensionLevelLabel,
  dimensionSummaryLabel,
  findingCopy,
  healthStatusLabel,
  limitationLabel,
  missingEvidenceLabel,
  readinessLabel,
  recommendationSummaryLabel,
  riskLabel,
  suggestedActionLabel
} from "./report-copy.js";

const DIMENSION_LABELS: Record<keyof AnalysisReport["assessment"]["dimensions"], string> = {
  context_pressure: "上下文压力",
  stale_context: "陈旧上下文",
  repetition: "重复内容",
  tool_noise: "工具噪声",
  continuation: "续接完整度",
  observability: "可观测性"
};
const MAX_FINDING_EVIDENCE = 5;
const MAX_QUEUE_ITEMS = 20;

export function formatReportMarkdown(report: Readonly<AnalysisReport>): string {
  const lines: string[] = ["# trimctx 会话健康报告", ""];
  const queueByMessageId = new Map(report.review_queue.items.map(item => [item.message_id, item]));

  lines.push("## 结论", "");
  lines.push(`- 状态：${healthStatusLabel(report.assessment.status)}`);
  lines.push(`- 置信度：${confidenceLabel(report.assessment.confidence)}`);
  lines.push(`- ${safeMarkdownText(assessmentSummaryLabel(report.assessment.summary))}`);
  if (report.assessment.status === "unknown") {
    lines.push("- 当前证据不足，不能把会话描述为干净或健康。");
  }
  lines.push("");

  lines.push("## 健康维度", "");
  lines.push("| 维度 | 等级 | 证据数 | 摘要 |");
  lines.push("| --- | --- | ---: | --- |");
  for (const [key, dimension] of Object.entries(report.assessment.dimensions) as Array<[
    keyof AnalysisReport["assessment"]["dimensions"],
    AnalysisReport["assessment"]["dimensions"][keyof AnalysisReport["assessment"]["dimensions"]]
  ]>) {
    lines.push(`| ${DIMENSION_LABELS[key]} | ${dimensionLevelLabel(dimension.level)} | ${dimension.evidence_count} | ${safeTableText(dimensionSummaryLabel(dimension.summary))} |`);
  }
  lines.push("");

  lines.push("## 关键发现", "");
  const displayFindings = report.findings.filter(finding => finding.type !== "limitation");
  if (displayFindings.length === 0) {
    lines.push("没有高置信风险发现。");
  } else {
    for (const finding of displayFindings) {
      const copy = findingCopy(finding);
      lines.push(`### ${safeMarkdownText(copy.title)}`, "");
      lines.push(`- 发现：${safeMarkdownText(copy.title)}`);
      lines.push(`- 依据：${safeMarkdownText(copy.explanation)}`);
      lines.push(`- 影响：${finding.impact.message_count} 条消息，${finding.impact.tokens} tokens`);
      lines.push(`- 行动：${suggestedActionLabel(finding.suggested_action)}`);
      lines.push("- 证据：");
      if (finding.evidence.length === 0) {
        lines.push("  - 无可安全展示的消息证据。");
      } else {
        for (const evidence of finding.evidence.slice(0, MAX_FINDING_EVIDENCE)) {
          lines.push(`  - ${formatEvidence(evidence, queueByMessageId.get(evidence.message_id))}`);
        }
        const omittedEvidence = finding.evidence.length - MAX_FINDING_EVIDENCE;
        if (omittedEvidence > 0) {
          lines.push(`  - 另有 ${omittedEvidence} 条证据，请查看 JSON report/candidate_groups。`);
        }
      }
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## 审查队列", "");
  renderQueue(lines, report.review_queue.items.filter(item => !item.protected));
  lines.push("");

  lines.push("## Protected 但疑似陈旧", "");
  renderQueue(lines, report.review_queue.items.filter(item => item.protected));
  lines.push("");

  lines.push("## 续接状态", "");
  lines.push(`- 就绪度：${readinessLabel(report.resume.readiness.level)} (${report.resume.readiness.score}/100)`);
  lines.push(`- 当前目标：${safeMarkdownText(report.resume.currentGoal?.text ?? "未提取到可信目标")}`);
  lines.push(`- 缺失项：${report.resume.readiness.missing.length > 0 ? report.resume.readiness.missing.map(missingEvidenceLabel).map(safeMarkdownText).join("、") : "无"}`);
  lines.push(`- 下一步：${safeMarkdownText(report.resume.nextSteps[0]?.text ?? "未提取到可信下一步")}`);
  lines.push("");

  lines.push("## 限制与安全说明", "");
  if (report.assessment.limitations.length === 0) {
    lines.push("- 未记录额外评估限制。");
  } else {
    for (const limitation of report.assessment.limitations) {
      lines.push(`- ${safeMarkdownText(limitationLabel(limitation))}`);
    }
  }
  lines.push("- 健康仅表示当前证据下风险较低，不构成删除许可。");
  lines.push("- 未知表示证据不足，不表示会话干净或没有风险。");
  lines.push("- 受保护内容永不自动删除；所有候选项都需要人工审查。");
  lines.push("- 原始 JSONL 始终只读，报告和压缩结果必须写入其他文件。");
  lines.push("");

  lines.push("## 下一步", "");
  for (const recommendation of [...report.recommendations].sort((left, right) => left.priority - right.priority)) {
    lines.push(`- ${safeMarkdownText(recommendationSummaryLabel(recommendation, report.resume.readiness.missing))}${recommendation.command ? ` ${safeCodeSpan(recommendation.command)}` : ""}`);
  }
  lines.push(`- ${safeCodeSpan(`trimctx report ${quotePath(report.input.file)} -o report.md`)}`);
  lines.push(`- ${safeCodeSpan(`trimctx report ${quotePath(report.input.file)} -o report.json`)}`);
  return `${lines.join("\n")}\n`;
}

function renderQueue(lines: string[], items: readonly ReviewQueueItem[]): void {
  if (items.length === 0) {
    lines.push("没有需要列入此队列的消息。");
    return;
  }
  lines.push("| Message ID | Line | Role | Decision | Protected | Risk | Confidence | 摘要 |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | --- |");
  for (const item of items.slice(0, MAX_QUEUE_ITEMS)) {
    lines.push(`| ${safeTableText(item.message_id)} | ${item.source_line} | ${item.role} | ${item.decision} | ${item.protected ? "是" : "否"} | ${riskLabel(item.risk)} | ${confidenceLabel(item.confidence)} | ${safeSummary(item.summary)} |`);
  }
  const omittedItems = items.length - MAX_QUEUE_ITEMS;
  if (omittedItems > 0) {
    lines.push(`另有 ${omittedItems} 条消息，请查看 JSON report/review_queue。`);
  }
}

function formatEvidence(evidence: FindingEvidenceRef, queueItem: ReviewQueueItem | undefined): string {
  const summary = queueItem ? safeSummary(queueItem.summary) : "无可安全展示的摘要";
  return `message ${safeMarkdownText(evidence.message_id)}, line ${evidence.source_line}, ${evidence.role}: ${summary}`;
}

function sanitizeSummary(value: string): string {
  const redacted = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return redacted.length <= 160 ? redacted : `${redacted.slice(0, 157)}...`;
}

function safeSummary(value: string): string {
  return escapeMarkdownText(sanitizeSummary(value));
}

function safeTableText(value: string): string {
  return safeMarkdownText(value);
}

function safeMarkdownText(value: string): string {
  return escapeMarkdownText(redactSensitiveText(value).replace(/\s+/g, " ").trim());
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+\/-]+={0,2}/gi, "Authorization: Bearer [REDACTED]")
    .replace(/\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/=]+/gi, "Authorization: Basic [REDACTED]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;|]+/gi, "$1=[REDACTED]");
}

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll("[REDACTED_EMAIL]", "\u0000EMAIL\u0000")
    .replaceAll("[REDACTED]", "\u0000SECRET\u0000")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_[\]{}()#!|~]/g, "\\$&")
    .replaceAll("\u0000EMAIL\u0000", "[REDACTED_EMAIL]")
    .replaceAll("\u0000SECRET\u0000", "[REDACTED]");
}

function safeCodeSpan(value: string): string {
  const safe = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  const maxBacktickRun = Math.max(0, ...(safe.match(/`+/g) ?? []).map(run => run.length));
  const delimiter = "`".repeat(maxBacktickRun + 1);
  const needsPadding = safe.startsWith("`") || safe.endsWith("`");
  return needsPadding
    ? `${delimiter} ${safe} ${delimiter}`
    : `${delimiter}${safe}${delimiter}`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
