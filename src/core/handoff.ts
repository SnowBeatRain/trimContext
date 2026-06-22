import { formatNextContextMarkdown, formatResumeMarkdown } from "./resume/markdown.js";
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
  lines.push(`- Tokenizer: ${report.tokenization.tokenizer} (${report.tokenization.confidence})`);
  lines.push("");
  lines.push(formatResumeMarkdown(report.resume));
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
  lines.push("- Treat `remove_candidate` as the only class eligible for destructive workflows, and still review it before use.");
  lines.push("- Treat `compress_candidate` as report-only review signal; it stays preserved by default and is not promoted automatically.");
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
  const base = formatNextContextMarkdown(report.resume).trimEnd();
  const lines: string[] = [base, "", "## Operating Rules"];
  lines.push("- This context is heuristic; verify it for accuracy and sensitive content before pasting or sharing.");
  lines.push("- Do not modify the original JSONL transcript; write reports, handoffs, and compressed copies to new files.");
  lines.push("- Only `remove_candidate` messages are eligible for destructive workflows, and they still require review.");
  lines.push("- Treat `compress_candidate` as report-only signal; preserve it by default.");
  lines.push("");
  lines.push("## Next Commands");
  lines.push(`- \`trimctx analyze ${quotePath(report.input.file)}\``);
  lines.push(`- \`trimctx report ${quotePath(report.input.file)} -o report.json\``);
  lines.push(`- \`trimctx handoff ${quotePath(report.input.file)} -o handoff.md --next-context next-context.md\``);
  lines.push("");
  lines.push("## Source");
  lines.push(`- File: ${report.input.file}`);
  lines.push(`- Tokenizer: ${report.tokenization.tokenizer} (${report.tokenization.confidence})`);
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
