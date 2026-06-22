import { scoreResumeReadiness } from "./readiness.js";
import type { AnalyzedMessage } from "../../types/report.js";
import type { ResumeEvidence, ResumeFileEvidence, ResumeState } from "../../types/resume.js";

const GOAL_PATTERN = /(?:目标|goal|任务|需要|完成|实现|改造|修复|发布)/i;
const EXPLICIT_GOAL_PATTERN = /(?:目标|goal|task|任务)[：:]/i;
const DECISION_PATTERN = /(?:必须|不要|不能|确定|决定|改成|保留|不新增|只能|should|must|do not|don't|instead)/i;
const FAILURE_PATTERN = /(?:失败|报错|错误|error|failed|failure|exception|traceback|expected .* got|blocked)/i;
const TEST_PATTERN = /(?:npm test|npm run build|vitest|jest|pytest|cargo test|go test|tsc|typecheck|build|测试|质量门)/i;
const NEXT_STEP_PATTERN = /(?:下一步|接下来|todo|待执行|start here|next step|remaining|继续|然后)/i;
const FILE_PATH_PATTERN = /(?:^|[\s`"'(:])((?:src|tests|docs|scripts|plugins|codex)\/[\w./-]+\.[A-Za-z0-9]+)(?=$|[\s`"'),.:;])/g;
const MAX_ITEMS = 6;

export function extractResumeState(report: { messages: AnalyzedMessage[] }): ResumeState {
  const recentMessages = [...report.messages].reverse();
  const currentGoal = findCurrentGoal(recentMessages);
  const decisions = collectEvidence(recentMessages, DECISION_PATTERN);
  const activeFiles = collectActiveFiles(recentMessages);
  const failures = collectEvidence(recentMessages, FAILURE_PATTERN);
  const testSignals = collectEvidence(recentMessages, TEST_PATTERN);
  const nextSteps = collectEvidence(recentMessages, NEXT_STEP_PATTERN);
  const partial: Omit<ResumeState, "readiness"> = {
    currentGoal,
    decisions,
    activeFiles,
    failures,
    testSignals,
    nextSteps
  };
  const readiness = scoreResumeReadiness(partial);
  return { ...partial, readiness };
}

function findCurrentGoal(messages: AnalyzedMessage[]): ResumeEvidence | undefined {
  const goalMessages = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      GOAL_PATTERN.test(message.content) &&
      !NEXT_STEP_PATTERN.test(message.content) &&
      message.content.trim().length >= 10
  );
  const goalMessage =
    goalMessages.find((message) => message.role === "user" && EXPLICIT_GOAL_PATTERN.test(message.content)) ??
    goalMessages.find((message) => message.role === "user") ??
    goalMessages.find((message) => EXPLICIT_GOAL_PATTERN.test(message.content)) ??
    goalMessages[0];
  return goalMessage ? toEvidence(goalMessage) : undefined;
}

function collectEvidence(messages: AnalyzedMessage[], pattern: RegExp): ResumeEvidence[] {
  const seen = new Set<string>();
  const items: ResumeEvidence[] = [];
  for (const message of messages) {
    if (!pattern.test(message.content)) continue;
    const evidence = toEvidence(message);
    const key = normalizeText(evidence.text);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(evidence);
    if (items.length >= MAX_ITEMS) break;
  }
  return items.reverse();
}

function collectActiveFiles(messages: AnalyzedMessage[]): ResumeFileEvidence[] {
  const seen = new Set<string>();
  const items: ResumeFileEvidence[] = [];
  for (const message of messages) {
    for (const path of extractFilePaths(message.content)) {
      if (seen.has(path)) continue;
      seen.add(path);
      items.push({ path, sourceLine: message.sourceLine, messageId: message.id });
      if (items.length >= MAX_ITEMS) return items.reverse();
    }
  }
  return items.reverse();
}

function extractFilePaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(FILE_PATH_PATTERN)) {
    paths.push(match[1]);
  }
  return paths;
}

function toEvidence(message: AnalyzedMessage): ResumeEvidence {
  return {
    text: summarize(message.content),
    sourceLine: message.sourceLine,
    messageId: message.id,
    role: message.role
  };
}

function summarize(text: string): string {
  const cleaned = redactSensitiveText(text).replace(/\s+/g, " ").trim();
  return cleaned.length <= 220 ? cleaned : `${cleaned.slice(0, 217)}...`;
}

function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:sk|pk|ghp|github_pat|glpat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi, "$1[REDACTED]@");
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
