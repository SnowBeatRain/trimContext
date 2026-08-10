import { scoreResumeReadiness } from "./readiness.js";
import type { AnalyzedMessage } from "../../types/report.js";
import type { ResumeEvidence, ResumeFileEvidence, ResumeState } from "../../types/resume.js";
import type { EvidenceConfidence } from "../../types/signals.js";
import { redactSensitiveText } from "../redaction.js";

const EXPLICIT_GOAL_PATTERN = /^(?:目标|goal|task|任务)\s*[：:]/i;
const DECISION_PATTERN = /(?:必须|不要|不能|确定|决定|改成|保留|不新增|只能|should|must|do not|don't|instead)/i;
const FAILURE_PATTERN = /(?:失败|报错|错误|error|failed|failure|exception|traceback|expected .* got|blocked)/i;
const TEST_PATTERN = /(?:npm test|npm run build|vitest|jest|pytest|cargo test|go test|tsc|typecheck|build|测试|质量门)/i;
const NEXT_STEP_PATTERN = /^(?:下一步|接下来|todo|待执行|start here|next step|remaining)\s*[：:]?|^(?:继续|然后)\b/i;
const FILE_PATH_PATTERN = /(?:^|[\s`"'(:])((?:src|tests|docs|scripts|plugins|codex)\/[\w./-]+\.[A-Za-z0-9]+)(?=$|[\s`"'),.:;])/g;
const MAX_ITEMS = 6;

export function extractResumeState(report: { messages: AnalyzedMessage[] }): ResumeState {
  const recentMessages = [...report.messages].reverse();
  const evidenceMessages = recentMessages.filter(isResumeEvidenceSource);
  const currentGoal = findCurrentGoal(recentMessages);
  const decisions = collectDecisions(recentMessages);
  const activeFiles = collectActiveFiles(recentMessages.filter(isActiveFileEvidenceSource));
  const failures = collectEvidence(evidenceMessages, FAILURE_PATTERN);
  const testSignals = collectEvidence(evidenceMessages, TEST_PATTERN);
  const nextSteps = collectTrustedEvidence(recentMessages, NEXT_STEP_PATTERN);
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
  const userMessages = messages.filter(
    (message) => message.role === "user" && isTrustedBody(message)
  );
  for (const message of userMessages) {
    const segment = extractSegments(message.content).find((item) => EXPLICIT_GOAL_PATTERN.test(item));
    if (segment) return toEvidence(message, segment, "high");
  }
  for (const message of userMessages) {
    const segment = extractSegments(message.content).find(isSubstantiveUserSegment);
    if (segment) return toEvidence(message, segment, "medium");
  }
  return undefined;
}

function collectEvidence(messages: AnalyzedMessage[], pattern: RegExp): ResumeEvidence[] {
  const seen = new Set<string>();
  const items: ResumeEvidence[] = [];
  for (const message of messages) {
    const segment = extractSegments(message.content).find((item) => pattern.test(item));
    if (!segment) continue;
    const evidence = toEvidence(message, segment, confidenceForMessage(message));
    const key = normalizeText(evidence.text);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(evidence);
    if (items.length >= MAX_ITEMS) break;
  }
  return items.reverse();
}

function collectDecisions(messages: AnalyzedMessage[]): ResumeEvidence[] {
  const user = collectTrustedEvidence(messages.filter((message) => message.role === "user"), DECISION_PATTERN);
  const confirmedAssistant = collectTrustedEvidence(
    messages.filter((message) => message.role === "assistant" && isConfirmedAssistantResult(message)),
    DECISION_PATTERN
  );
  return [...user, ...confirmedAssistant].slice(0, MAX_ITEMS);
}

function collectTrustedEvidence(messages: AnalyzedMessage[], pattern: RegExp): ResumeEvidence[] {
  return collectEvidence(
    messages.filter((message) => isTrustedBody(message)),
    pattern
  );
}

function collectActiveFiles(messages: AnalyzedMessage[]): ResumeFileEvidence[] {
  const seen = new Set<string>();
  const items: ResumeFileEvidence[] = [];
  for (const message of messages) {
    for (const path of extractFilePaths(message.content)) {
      if (seen.has(path)) continue;
      seen.add(path);
      items.push({
        path,
        sourceLine: message.sourceLine,
        messageId: message.id,
        role: message.role,
        confidence: confidenceForMessage(message)
      });
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

function toEvidence(message: AnalyzedMessage, text: string, confidence: EvidenceConfidence): ResumeEvidence {
  return {
    text: summarize(text),
    sourceLine: message.sourceLine,
    messageId: message.id,
    role: message.role,
    confidence
  };
}

function extractSegments(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.replace(/^\s*(?:[-*+] |\d+[.)]\s*)/, "").split(/(?<=[。！？!?;；])\s*/u))
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSubstantiveUserSegment(text: string): boolean {
  const compact = text.trim();
  if (compact.length < 10) return false;
  if (/^(?:ok|okay|yes|no|thanks?|好的|可以|确认|收到|明白)[.!。！]?$/i.test(compact)) return false;
  if (NEXT_STEP_PATTERN.test(compact) || DECISION_PATTERN.test(compact)) return false;
  return true;
}

function isTrustedBody(message: AnalyzedMessage): boolean {
  return (message.role === "user" || message.role === "assistant")
    && !isMetadata(message)
    && !isToolContainer(message);
}

function isResumeEvidenceSource(message: AnalyzedMessage): boolean {
  return (message.role === "user" || message.role === "assistant" || message.role === "tool")
    && !isMetadata(message);
}

function isActiveFileEvidenceSource(message: AnalyzedMessage): boolean {
  return isTrustedBody(message) || message.analysis.kind === "tool_use";
}

function isMetadata(message: AnalyzedMessage): boolean {
  return message.analysis.kind === "metadata";
}

function isToolContainer(message: AnalyzedMessage): boolean {
  return message.analysis.kind === "tool_use" || message.analysis.kind === "tool_result";
}

function isConfirmedAssistantResult(message: AnalyzedMessage): boolean {
  return message.analysis.kind === "result" || /(?:已确认|最终决定|confirmed|completed|implemented|done)/i.test(message.content);
}

function confidenceForMessage(message: AnalyzedMessage): EvidenceConfidence {
  if (isToolContainer(message)) return "low";
  if (message.role === "user") return "high";
  if (message.role === "assistant") return "medium";
  return "low";
}

function summarize(text: string): string {
  const cleaned = redactSensitiveText(text).replace(/\s+/g, " ").trim();
  return cleaned.length <= 220 ? cleaned : `${cleaned.slice(0, 217)}...`;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
