import type { AnalysisReport } from "../types/report.js";

const STATE_START = "<!-- TRIMCTX_STATE_START -->";
const STATE_END = "<!-- TRIMCTX_STATE_END -->";

const REASON_LABELS: Record<string, string> = {
  low_value_metadata: "metadata noise",
  old_message: "old content",
  superseded_by_later_instruction: "superseded",
  low_reference_in_later_context: "low reference",
  duplicate_nearby_message: "duplicate",
  orphan_tool_result: "orphan tool",
  large_low_value_tool_output: "large tool output",
  contains_file_path: "file path",
  recent_message: "recent",
  contains_code_block: "code block",
  contains_tool_interaction: "tool interaction",
};

type HealthLevel = "ok" | "moderate" | "heavy";

function healthLevel(rotRate: number): HealthLevel {
  if (rotRate < 0.1) return "ok";
  if (rotRate < 0.3) return "moderate";
  return "heavy";
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return `${tokens}`;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatContextState(report: AnalysisReport): string {
  const s = report.summary;
  const rotCount = s.remove_candidates + s.compress_candidates;
  const rotRate = s.total_messages === 0 ? 0 : rotCount / s.total_messages;
  const health = healthLevel(rotRate);
  const healthLabels = { ok: "OK", moderate: "MODERATE", heavy: "HEAVY" };
  const pressureLabels = { low: "LOW", medium: "MEDIUM", high: "HIGH" };

  const lines: string[] = [];
  lines.push(STATE_START);
  lines.push("## trimctx 上下文状态（自动维护，请勿手动编辑）");
  lines.push("");
  lines.push(`- 消息：${s.total_messages} 条 / ~${formatTokens(s.total_tokens)} tokens`);
  lines.push(`- 压力：${pressureLabels[s.context_pressure.pressure_level]}  健康：${healthLabels[health]}  腐化：${formatRatio(rotRate)}`);

  if (rotCount > 0) {
    lines.push(`- 可移除：${s.remove_candidates} 条 / ~${formatTokens(s.context_pressure.estimated_removable_tokens)} tokens`);
    if (s.compress_candidates > 0) {
      lines.push(`- 可压缩：${s.compress_candidates} 条（仅报告）`);
    }
  }

  if (s.top_reasons.length > 0) {
    const reasonStr = s.top_reasons
      .slice(0, 3)
      .map(r => `${REASON_LABELS[r.reason] ?? r.reason}(${r.count})`)
      .join(", ");
    lines.push(`- 主要信号：${reasonStr}`);
  }

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
