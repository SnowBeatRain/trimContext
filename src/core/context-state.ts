import type { AnalysisReport } from "../types/report.js";
import { formatRatio, formatScore, formatTokens } from "./format.js";
import { reasonLabel } from "./reason-labels.js";

const STATE_START = "<!-- TRIMCTX_STATE_START -->";
const STATE_END = "<!-- TRIMCTX_STATE_END -->";

type HealthLevel = "ok" | "moderate" | "heavy";

function healthLevel(rotRate: number): HealthLevel {
  if (rotRate < 0.1) return "ok";
  if (rotRate < 0.3) return "moderate";
  return "heavy";
}

function formatRoleCounts(roleCounts: AnalysisReport["parser_diagnostics"]["role_counts"]): string {
  const roles = ["system", "user", "assistant", "tool", "developer", "unknown"] as const;
  return roles
    .filter((role) => (roleCounts[role] ?? 0) > 0)
    .map((role) => `${role} ${roleCounts[role]}`)
    .join(" / ");
}

function formatTokenMode(report: AnalysisReport): string {
  const estimated = report.summary.token_estimation.estimated ? "估算" : "精确";
  return `${report.tokenization.tokenizer} / ${report.tokenization.confidence} / ${estimated}`;
}

function formatNextAction(report: AnalysisReport): string {
  const removeCount = report.summary.remove_candidates;
  const compressCount = report.summary.compress_candidates;
  if (removeCount > 0) {
    return "先运行 `trimctx report` 审查 remove_candidate；compress_candidate 默认保留。";
  }
  if (compressCount > 0) {
    return "当前只有 compress_candidate；默认保留，可用 `trimctx new-chat` 生成续接上下文。";
  }
  return "暂无安全删除候选；继续收集样本或运行 `trimctx new-chat` 做交接。";
}

export function formatContextState(report: AnalysisReport): string {
  const s = report.summary;
  const rotCount = s.remove_candidates + s.compress_candidates;
  const rotRate = s.total_messages === 0 ? 0 : rotCount / s.total_messages;
  const health = healthLevel(rotRate);
  const healthLabels = { ok: "OK", moderate: "MODERATE", heavy: "HEAVY" };
  const pressureLabels = { low: "LOW", medium: "MEDIUM", high: "HIGH" };
  const parser = report.parser_diagnostics;
  const scoreDiagnostics = s.score_diagnostics;

  const lines: string[] = [];
  lines.push(STATE_START);
  lines.push("## trimctx 上下文状态（自动维护，请勿手动编辑）");
  lines.push("");
  lines.push(`- 消息：${s.total_messages} 条 / ~${formatTokens(s.total_tokens)} tokens`);
  lines.push(`- 来源：${parser.source}`);
  lines.push(`- 解析：${parser.parsed_messages} 条，行 ${parser.source_lines.min}-${parser.source_lines.max}`);

  const roleSummary = formatRoleCounts(parser.role_counts);
  if (roleSummary) {
    lines.push(`- 角色：${roleSummary}`);
  }

  lines.push(`- Token：${formatTokenMode(report)}`);
  lines.push(`- 压力：${pressureLabels[s.context_pressure.pressure_level]}  健康：${healthLabels[health]}  腐化：${formatRatio(rotRate)}`);
  lines.push(`- 保护：${s.protected_messages} 条 / ~${formatTokens(s.context_pressure.estimated_protected_tokens)} tokens / ${formatRatio(s.context_pressure.protected_token_ratio)}`);

  if (rotCount > 0) {
    lines.push(`- 可移除：${s.remove_candidates} 条 / ~${formatTokens(s.context_pressure.estimated_removable_tokens)} tokens`);
    if (s.compress_candidates > 0) {
      lines.push(`- 可压缩：${s.compress_candidates} 条（仅报告）`);
    }
  }

  lines.push(`- 候选：remove ${s.remove_candidates} / compress ${s.compress_candidates} / near-threshold ${scoreDiagnostics.near_remove_threshold_count} / protected-high-rot ${scoreDiagnostics.protected_high_rot_count}`);
  lines.push(`- 分数：max ${formatScore(scoreDiagnostics.max_rot_score)} / p90 ${formatScore(scoreDiagnostics.p90_rot_score)}`);

  if (s.top_reasons.length > 0) {
    const reasonStr = s.top_reasons
      .slice(0, 5)
      .map(r => `${reasonLabel(r.reason)}(${r.count})`)
      .join(", ");
    lines.push(`- 主要信号：${reasonStr}`);
  }

  const parserNotes: string[] = [];
  if (parser.empty_content_messages > 0) parserNotes.push(`empty ${parser.empty_content_messages}`);
  if (parser.missing_timestamp_messages > 0) parserNotes.push(`missing-ts ${parser.missing_timestamp_messages}`);
  if (parserNotes.length > 0) {
    lines.push(`- 解析备注：${parserNotes.join(" / ")}`);
  }

  lines.push(`- 信任：Phase0 ${report.phase0_trust.status}（人工标注指标未锁定前不自动删除）`);
  lines.push(`- 续接：${report.resume.readiness.level.toUpperCase()} ${report.resume.readiness.score}/100，目标 ${report.resume.currentGoal?.text ?? "未识别"}`);
  lines.push(`- 建议：${formatNextAction(report)}`);

  if (report.warnings.length > 0) {
    const compactWarnings = report.warnings.filter(w => w.includes("session_compacted"));
    if (compactWarnings.length > 0) {
      lines.push(`- 已有压缩事件`);
    }
  }

  lines.push(`- 更新：${new Date().toISOString()}`);
  lines.push(STATE_END);

  return lines.join("\n");
}

export function injectContextStateSection(claudeMdContent: string, stateSection: string): string {
  const startIndex = claudeMdContent.indexOf(STATE_START);
  const endIndex = claudeMdContent.indexOf(STATE_END);

  if (startIndex !== -1 && endIndex !== -1) {
    const before = claudeMdContent.slice(0, startIndex);
    const after = claudeMdContent.slice(endIndex + STATE_END.length);
    if (!stateSection) {
      return `${before.trimEnd()}\n${after.trimStart()}`.trimEnd() + "\n";
    }
    return `${before}${stateSection}\n${after}`;
  }

  if (!stateSection) {
    return claudeMdContent;
  }

  const separator = claudeMdContent.endsWith("\n") ? "" : "\n";
  return `${claudeMdContent}${separator}\n${stateSection}\n`;
}
