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
  lines.push("- This handoff package may include original transcript content and secrets; review it before sharing or pasting into another system.");
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
  lines.push(`- \`trimctx new-chat ${quotePath(report.input.file)}\``);
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

export function formatHandoffReadme(report: AnalysisReport): string {
  const lines: string[] = [];
  lines.push("# trimctx New Chat Package");
  lines.push("");
  lines.push("这个目录是 trimctx 为长对话续接生成的本地续聊包。");
  lines.push("");
  lines.push("## 下一步");
  lines.push("");
  lines.push("1. 打开 `next-context.md`。");
  lines.push("2. 复制里面的内容到新的 AI 会话窗口。");
  lines.push("3. 原窗口可以保留；原始 transcript 没有被修改。");
  lines.push("");
  lines.push("## 文件说明");
  lines.push("");
  lines.push(`- \`next-context.md\`：最适合复制到新窗口的精简上下文。`);
  lines.push(`- \`handoff.md\`：更完整的交接说明和安全审查线索。`);
  lines.push(`- \`report.json\`：完整机器可读分析报告，适合高级审计。`);
  lines.push(`- \`manifest.json\`：本续聊包的元数据和原始文件 hash。`);
  lines.push("");
  lines.push("## 安全说明");
  lines.push("");
  lines.push("- trimctx 只写入这个续聊包，原始 transcript 没有被修改。");
  lines.push("- 这个包可能包含原对话内容或敏感信息，分享前请先检查。");
  lines.push("- 默认建议先用 new-chat 续接；compress 是审计后的高级命令。");
  lines.push("");
  lines.push("## 来源");
  lines.push("");
  lines.push(`- File: ${report.input.file}`);
  lines.push(`- Format: ${report.input.source}`);
  lines.push(`- Messages: ${report.summary.total_messages}`);
  lines.push(`- Estimated tokens: ${report.summary.total_tokens}`);
  return `${lines.join("\n")}\n`;
}
