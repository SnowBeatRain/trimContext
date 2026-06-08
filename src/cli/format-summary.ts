import type { AnalysisReport } from "../types/report.js";

export function formatAnalysisSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const s = report.summary;
  const color = options?.color ?? false;
  const rotCount = s.remove_candidates + s.compress_candidates;
  const rotRate = s.total_messages === 0 ? 0 : rotCount / s.total_messages;
  const health = healthLevel(rotRate);
  const lines: string[] = [];

  lines.push(heading("trimctx analysis", color));
  lines.push("");
  lines.push(`  ${s.total_messages} messages / ${formatTokens(s.total_tokens)}`);
  lines.push(`  health: ${healthLabel(health, color)}  rot: ${formatRatio(rotRate)} (${rotCount} candidates)`);
  lines.push("");

  if (rotCount > 0) {
    lines.push("  breakdown:");
    if (s.remove_candidates > 0) {
      lines.push(`    remove:       ${s.remove_candidates} messages (${formatTokens(s.estimated_saving_tokens)})`);
    }
    if (s.compress_candidates > 0) {
      lines.push(`    compress:     ${s.compress_candidates} messages`);
    }
    lines.push(`    protected:    ${s.protected_messages} messages`);
    lines.push(`    saving:       ${formatTokens(s.estimated_saving_tokens)} (${formatRatio(s.estimated_saving_ratio)})`);
    lines.push("");

    const categories = categorizeReasons(report);
    if (categories.length > 0) {
      lines.push("  top reasons:");
      for (const cat of categories) {
        lines.push(`    - ${cat.label}: ${cat.count}`);
      }
      lines.push("");
    }
  } else {
    lines.push("  no rot detected. conversation is clean.");
    lines.push("");
  }

  lines.push("  next:");
  if (rotCount > 0) {
    lines.push(`    trimctx compress ${quotePath(report.input.file)} -o trimmed.jsonl`);
  }
  lines.push(`    trimctx analyze ${quotePath(report.input.file)} --json`);

  return `${lines.join("\n")}\n`;
}

type HealthLevel = "good" | "moderate" | "heavy";

function healthLevel(rotRate: number): HealthLevel {
  if (rotRate < 0.1) return "good";
  if (rotRate < 0.3) return "moderate";
  return "heavy";
}

function healthLabel(level: HealthLevel, color: boolean): string {
  if (color) {
    const codes = { good: "32", moderate: "33", heavy: "31" };
    const labels = { good: "OK", moderate: "MODERATE", heavy: "HEAVY" };
    return `\x1b[${codes[level]}m${labels[level]}\x1b[0m`;
  }
  const labels = { good: "OK", moderate: "MODERATE", heavy: "HEAVY" };
  return labels[level];
}

function heading(text: string, color: boolean): string {
  return color ? `\x1b[1m${text}\x1b[0m` : text;
}

const REASON_LABELS: Record<string, string> = {
  low_value_metadata: "metadata noise",
  old_message: "old content",
  superseded_by_later_instruction: "superseded",
  low_reference_in_later_context: "low reference",
  duplicate_nearby_message: "duplicate",
  orphan_tool_result: "orphan tool result",
  large_low_value_tool_output: "large tool output",
  contains_file_path: "file path",
  contains_architecture_or_api_decision: "architecture",
  recent_message: "recent",
  contains_code_block: "code block",
  contains_test_failure: "test failure",
  system_or_developer_message: "system message",
  contains_user_decision: "user decision",
  contains_memory_instruction: "memory instruction",
  contains_error_stack: "error stack",
  contains_shell_command: "shell command",
  contains_git_diff: "git diff",
  tool_result_referenced_later: "referenced tool",
  references_tool_result: "references tool"
};

function categorizeReasons(report: AnalysisReport): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const msg of report.remove_candidates) {
    for (const reason of msg.reasons) {
      const label = REASON_LABELS[reason] ?? reason;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K tokens`;
  return `${tokens} tokens`;
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
