import type { NormalizedMessage } from "../types/message.js";

export function assertUniqueMessageIds(messages: readonly NormalizedMessage[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const message of messages) {
    if (seen.has(message.id)) {
      duplicates.add(message.id);
    }
    seen.add(message.id);
  }

  if (duplicates.size > 0) {
    const suffix = duplicates.size === 1 ? "" : "s";
    throw new Error(
      `Cannot compress transcript with ${duplicates.size} duplicate message ID${suffix}`
    );
  }
}
