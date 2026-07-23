import type { NormalizedMessage } from "../../types/message.js";
import type { SignalEvidence } from "../../types/signals.js";
import { addEvidence, createEvidence } from "./duplicates.js";

const HIGH_PREFIX = /^\s*\[(?:file-history-snapshot|ai-title|mode|permission-mode)\]\s*/i;
const MEDIUM_PREFIX = /^\s*\[(?:last-prompt|attachment)\]\s*/i;
const HIGH_EVENTS = new Set(["file-history-snapshot", "ai-title", "mode", "permission-mode"]);

export function detectMetadataEvidence(messages: NormalizedMessage[]): Map<string, SignalEvidence[]> {
  const evidence = new Map<string, SignalEvidence[]>();
  for (const message of messages) {
    const raw = typeof message.raw === "object" && message.raw !== null ? message.raw as Record<string, unknown> : undefined;
    const rawType = typeof raw?.type === "string" ? raw.type.toLowerCase() : "";
    const content = message.content;
    const high = HIGH_PREFIX.test(content) || HIGH_EVENTS.has(rawType);
    const attachment = (rawType === "attachment" || /^\s*\[attachment\]/i.test(content)) && /(?:skill_listing|mcp[_-]?instructions)/i.test(content) && (message.tokens ?? 0) >= 200;
    const medium = !high && (rawType === "last-prompt" || /^\s*\[last-prompt\]/i.test(content) || attachment);
    if (high || medium) {
      addEvidence(evidence, message, createEvidence(message, "low_value_metadata", high ? "high" : "medium", undefined, { raw_type: rawType || "prefix", strength: high ? 0.9 : 0.65 }));
    }
  }
  return evidence;
}
