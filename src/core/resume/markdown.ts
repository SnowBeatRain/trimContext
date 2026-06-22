import type { ResumeEvidence, ResumeFileEvidence, ResumeState } from "../../types/resume.js";

export function formatResumeMarkdown(resume: ResumeState): string {
  const lines: string[] = [];
  lines.push("## Resume Readiness");
  lines.push(`- Score: ${resume.readiness.score}/100 (${resume.readiness.level})`);
  lines.push(`- Missing: ${resume.readiness.missing.length === 0 ? "none" : resume.readiness.missing.join(", ")}`);
  lines.push("- Review: heuristic extraction; verify before sharing or pasting into another session.");
  lines.push("");
  lines.push("## Current Goal");
  lines.push(evidenceLine(resume.currentGoal));
  lines.push("");
  lines.push("## User Decisions");
  lines.push(...evidenceList(resume.decisions));
  lines.push("");
  lines.push("## Active Files");
  lines.push(...fileList(resume.activeFiles));
  lines.push("");
  lines.push("## Failed Attempts / Do Not Repeat");
  lines.push(...evidenceList(resume.failures));
  lines.push("");
  lines.push("## Current Test / Error");
  lines.push(...evidenceList(resume.testSignals));
  lines.push("");
  lines.push("## Next Step");
  lines.push(...evidenceList(resume.nextSteps));
  lines.push("");
  lines.push("## Safe Compact Instruction");
  lines.push("- Preserve user decisions, active files, failed attempts, and the next concrete step before trimming context.");
  return lines.join("\n");
}

export function formatNextContextMarkdown(resume: ResumeState): string {
  const lines: string[] = [];
  lines.push("# Next Context");
  lines.push("");
  lines.push("Use this heuristic handoff to continue the session after reviewing it for accuracy and sensitive content.");
  lines.push("");
  lines.push("# Continue This Session");
  lines.push("");
  lines.push("## Goal");
  lines.push(evidenceText(resume.currentGoal));
  lines.push("");
  lines.push("## Must Remember");
  lines.push(...evidenceList(resume.decisions));
  lines.push("");
  lines.push("## Do Not Repeat");
  lines.push(...evidenceList(resume.failures));
  lines.push("");
  lines.push("## Active Files");
  lines.push(...fileList(resume.activeFiles));
  lines.push("");
  lines.push("## Current Problem");
  lines.push(...evidenceList(resume.testSignals));
  lines.push("");
  lines.push("## Start Here");
  lines.push(...evidenceList(resume.nextSteps));
  return `${lines.join("\n")}\n`;
}

function evidenceLine(evidence: ResumeEvidence | undefined): string {
  return evidence ? `- line ${evidence.sourceLine}: ${evidence.text}` : "- Not detected.";
}

function evidenceText(evidence: ResumeEvidence | undefined): string {
  return evidence ? `- ${evidence.text}` : "- Not detected.";
}

function evidenceList(items: ResumeEvidence[]): string[] {
  if (items.length === 0) return ["- Not detected."];
  return items.map((item) => `- line ${item.sourceLine}: ${item.text}`);
}

function fileList(items: ResumeFileEvidence[]): string[] {
  if (items.length === 0) return ["- Not detected."];
  return items.map((item) => `- ${item.path} (line ${item.sourceLine})`);
}
