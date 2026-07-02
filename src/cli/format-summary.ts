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
  lines.push(`  ${s.total_messages} messages / ~${formatTokens(s.total_tokens)}`);
  lines.push(
    `  token estimate: ${s.token_estimation.estimator_version} (${s.token_estimation.estimator}, ${s.token_estimation.confidence} confidence)`
  );
  lines.push(`  tokenizer: ${report.tokenization.tokenizer} (${report.tokenization.confidence} confidence)`);
  lines.push(
    `  context pressure: ${s.context_pressure.pressure_level.toUpperCase()}  removable: ${formatTokens(s.context_pressure.estimated_removable_tokens)} (${formatRatio(s.context_pressure.remove_candidate_ratio)})`
  );
  lines.push(`  health: ${healthLabel(health, color)}  rot: ${formatRatio(rotRate)} (${rotCount} candidates)`);
  lines.push("");
  lines.push("  trust:");
  if (s.remove_candidates === 0) {
    lines.push("    0 remove candidates means nothing crossed the safe deletion threshold.");
    lines.push("    compress candidates, if any, are report-only and kept by default.");
  } else {
    lines.push(`    ${s.remove_candidates} remove candidates crossed the safe deletion threshold.`);
    lines.push("    review the JSON report before applying destructive workflows.");
  }
  lines.push(`    phase0: ${report.phase0_trust.status.toUpperCase()}`);
  lines.push("    candidates are review-only until Phase 0 gates are locked.");
  lines.push(`    max score: ${s.score_diagnostics.max_rot_score.toFixed(4)}; near threshold: ${s.score_diagnostics.near_remove_threshold_count}`);

  if (report.warnings.length > 0) {
    for (const w of report.warnings) {
      lines.push(`  ! ${w}`);
    }
  }

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
    lines.push(
      `    token mix:    cjk ${s.token_breakdown.cjk_chars}, ascii ${s.token_breakdown.ascii_tokens}, code ${s.token_breakdown.code_like_segments}, json ${s.token_breakdown.json_like_segments}`
    );
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

  lines.push("  resume:");
  lines.push(
    `    readiness: ${report.resume.readiness.level.toUpperCase()} (${report.resume.readiness.score}/100)`
  );
  lines.push(`    goal: ${formatEvidenceText(report.resume.currentGoal?.text)}`);
  lines.push(`    next: ${formatEvidenceText(report.resume.nextSteps[0]?.text)}`);
  lines.push(`    active files: ${report.resume.activeFiles.length}`);
  lines.push("");

  lines.push("  next:");
  lines.push(`    trimctx report ${quotePath(report.input.file)} -o report.json`);
  if (report.phase0_trust.status === "locked" && rotCount > 0) {
    lines.push(`    trimctx compress ${quotePath(report.input.file)} -o trimmed.jsonl`);
  } else if (rotCount > 0) {
    lines.push("    run Phase 0 manual review before using compress output as replacement context");
  }
  lines.push(`    trimctx analyze ${quotePath(report.input.file)} --json`);

  return `${lines.join("\n")}\n`;
}


export function formatUserSummary(report: AnalysisReport, options?: { color?: boolean }): string {
  const s = report.summary;
  const rotCount = s.remove_candidates + s.compress_candidates;
  const decision = userDecision(report);
  const reasons = userReasons(report, rotCount);
  const lines: string[] = [];

  lines.push(heading("trimctx 看了一下当前会话：", options?.color ?? false));
  lines.push("");
  lines.push(`状态：${decision}`);
  lines.push(`文件：${report.input.file}`);
  lines.push("");
  lines.push("原因：");
  for (const reason of reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
  lines.push("下一步：");
  if (decision === "可以继续当前会话") {
    lines.push("  继续当前会话即可；如果准备换窗口，再运行 trimctx new-chat");
  } else {
    lines.push("  trimctx new-chat");
    lines.push("  然后把生成包里的 next-context.md 贴到新窗口");
  }
  lines.push("");
  lines.push("高级审计：");
  lines.push(`  trimctx report ${quotePath(report.input.file)} -o report.json`);
  lines.push(`  trimctx analyze ${quotePath(report.input.file)} --json`);
  lines.push("");
  lines.push("说明：trimctx 只做本地分析，没有上传文件；默认建议先用 new-chat，compress 属于审计后的高级命令。");
  return `${lines.join("\n")}\n`;
}

function userDecision(report: AnalysisReport): "可以继续当前会话" | "建议准备 new-chat" | "建议开新窗口续接" {
  const pressure = report.summary.context_pressure.pressure_level;
  const totalTokens = report.summary.total_tokens;
  const rotCount = report.summary.remove_candidates + report.summary.compress_candidates;

  if (pressure === "high" || totalTokens >= 150_000 || rotCount >= 50) {
    return "建议开新窗口续接";
  }
  if (pressure === "medium" || totalTokens >= 80_000 || rotCount > 0 || report.resume.readiness.level !== "blocked") {
    return "建议准备 new-chat";
  }
  return "可以继续当前会话";
}

function userReasons(report: AnalysisReport, rotCount: number): string[] {
  const s = report.summary;
  const reasons: string[] = [];
  reasons.push(`当前会话约 ${formatTokens(s.total_tokens)}，上下文压力 ${s.context_pressure.pressure_level.toUpperCase()}`);

  if (rotCount > 0) {
    reasons.push(`发现 ${rotCount} 条可能过时、重复或低价值的上下文信号`);
  } else {
    reasons.push("没有发现明显需要处理的旧上下文；保守结果不是失败");
  }

  if (report.resume.readiness.level === "ready") {
    reasons.push("最近目标、决策和下一步较完整，适合生成续接上下文");
  } else if (report.resume.readiness.level === "partial") {
    reasons.push("已有部分续接线索，可生成 new-chat 后人工确认");
  } else {
    reasons.push("续接线索偏少，建议继续当前会话或显式补充目标后再 new-chat");
  }

  const topReasons = categorizeReasons(report).slice(0, 2);
  for (const item of topReasons) {
    reasons.push(`${item.label}: ${item.count}`);
  }

  return reasons.slice(0, 5);
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

function formatEvidenceText(text: string | undefined): string {
  if (!text) return "none detected";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 96) return collapsed;
  return `${collapsed.slice(0, 93)}...`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
