import type { AnalysisReport, AnalyzedMessage } from "../types/report.js";

export function formatHandoff(report: AnalysisReport): string {
  const summary = report.summary;
  const removeCandidates = topCandidates(report.remove_candidates, 5);
  const protectedHighRot = topCandidates(
    report.messages.filter((message) => message.protected && message.rot_score >= 0.6),
    5
  );

  const lines: string[] = [];
  lines.push("# trimctx Handoff");
  lines.push("");
  lines.push("## Source");
  lines.push(`- File: ${report.input.file}`);
  lines.push(`- Format: ${report.input.source}`);
  lines.push(`- Messages: ${summary.total_messages}`);
  lines.push(`- Estimated tokens: ${summary.total_tokens}`);
  lines.push("");
  lines.push("## Safety Summary");
  lines.push(`- Remove candidates: ${summary.remove_candidates}`);
  lines.push(`- Compress candidates: ${summary.compress_candidates}`);
  lines.push(`- Protected messages: ${summary.protected_messages}`);
  lines.push(`- Estimated removable tokens: ${summary.estimated_saving_tokens}`);
  lines.push(`- Max rot score: ${summary.score_diagnostics.max_rot_score}`);
  lines.push(`- Near remove threshold: ${summary.score_diagnostics.near_remove_threshold_count}`);
  lines.push("");
  lines.push("## Continue From Here");
  lines.push("- Treat `remove_candidate` as the only automatically removable class.");
  lines.push("- Treat `compress_candidate` as report-only unless a human review promotes it.");
  lines.push("- Keep original JSONL unchanged; write compressed or handoff artifacts to new files.");
  lines.push("- If remove candidates are zero, continue from the health report instead of forcing deletion.");
  lines.push("");
  lines.push("## Candidate Review Queue");
  if (removeCandidates.length === 0) {
    lines.push("- No remove candidates crossed the current safety threshold.");
  } else {
    for (const message of removeCandidates) {
      lines.push(candidateLine(message));
    }
  }
  lines.push("");
  lines.push("## Protected High-Rot Signals");
  if (protectedHighRot.length === 0) {
    lines.push("- No protected high-rot messages detected.");
  } else {
    for (const message of protectedHighRot) {
      lines.push(candidateLine(message));
    }
  }
  lines.push("");
  lines.push("## Warnings");
  if (report.warnings.length === 0) {
    lines.push("- None.");
  } else {
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  lines.push("## Commands");
  lines.push(`- \`trimctx analyze ${quotePath(report.input.file)}\``);
  lines.push(`- \`trimctx report ${quotePath(report.input.file)} -o report.json\``);
  lines.push(`- \`trimctx compress ${quotePath(report.input.file)} -o trimmed.jsonl\``);
  return `${lines.join("\n")}\n`;
}

export function formatNextContext(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push("# Next Context");
  lines.push("");
  lines.push("Use this as the compact handoff for the next agent or session.");
  lines.push("");
  lines.push("## Current State");
  lines.push(`- Source file: ${report.input.file}`);
  lines.push(`- Source format: ${report.input.source}`);
  lines.push(`- Messages analyzed: ${report.summary.total_messages}`);
  lines.push(`- Remove candidates: ${report.summary.remove_candidates}`);
  lines.push(`- Compress candidates: ${report.summary.compress_candidates}`);
  lines.push("");
  lines.push("## Operating Rules");
  lines.push("- Do not modify the original JSONL file.");
  lines.push("- Review remove candidates before applying any destructive workflow.");
  lines.push("- Use score diagnostics as trust signals, not as automatic tuning instructions.");
  lines.push("");
  lines.push("## Next Commands");
  lines.push(`- \`trimctx analyze ${quotePath(report.input.file)}\``);
  lines.push(`- \`trimctx report ${quotePath(report.input.file)} -o report.json\``);
  lines.push(`- \`trimctx handoff ${quotePath(report.input.file)} -o handoff.md --next-context next-context.md\``);
  return `${lines.join("\n")}\n`;
}

function topCandidates(messages: AnalyzedMessage[], limit: number): AnalyzedMessage[] {
  return [...messages].sort((left, right) => right.rot_score - left.rot_score).slice(0, limit);
}

function candidateLine(message: AnalyzedMessage): string {
  const reasons = message.reasons.length > 0 ? message.reasons.join(", ") : "no reasons";
  return `- line ${message.sourceLine}, ${message.role}, score ${message.rot_score.toFixed(4)}: ${reasons}`;
}

function quotePath(file: string): string {
  return `"${file.replaceAll("\"", "\\\"")}"`;
}
