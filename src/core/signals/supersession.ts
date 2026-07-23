import type { NormalizedMessage } from "../../types/message.js";
import type { SignalEvidence } from "../../types/signals.js";
import { addEvidence, createEvidence, tokenJaccard } from "./duplicates.js";

const CORRECTION = /\b(?:correction|instead|ignore previous|replace|override|do not use|don't use)\b|(?:改成|更新为|不要用|忽略之前)/i;

export function detectSupersessionEvidence(messages: NormalizedMessage[]): Map<string, SignalEvidence[]> {
  const evidence = new Map<string, SignalEvidence[]>();
  for (let oldIndex = 0; oldIndex < messages.length; oldIndex += 1) {
    const old = messages[oldIndex]!;
    if (!eligible(old)) continue;
    for (let nextIndex = oldIndex + 1; nextIndex < messages.length; nextIndex += 1) {
      const replacement = messages[nextIndex]!;
      if (replacement.analysis?.segment !== old.analysis?.segment) break;
      if (!eligible(replacement) || !CORRECTION.test(replacement.content)) continue;
      const sharedIdentifier = old.analysis!.stable_identifiers.find((id) => replacement.analysis!.stable_identifiers.includes(id));
      const similarity = tokenJaccard(old.content.toLowerCase(), replacement.content.toLowerCase());
      if (!sharedIdentifier && similarity < 0.35) continue;
      addEvidence(evidence, old, createEvidence(old, "superseded", sharedIdentifier ? "high" : "medium", replacement, {
        ...(sharedIdentifier ? { identifier: sharedIdentifier } : {}), similarity
      }));
      break;
    }
  }
  return evidence;
}

function eligible(message: NormalizedMessage): boolean {
  return (message.role === "user" || message.role === "assistant") && Boolean(message.analysis);
}
