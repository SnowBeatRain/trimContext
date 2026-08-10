import { describe, expect, test } from "vitest";
import { assertUniqueMessageIds } from "../src/core/message-identity.js";
import type { NormalizedMessage } from "../src/types/message.js";

describe("message identity safety", () => {
  test("reports only the number of duplicate IDs", () => {
    const messages = [
      message("duplicate", "first private body", 1),
      message("duplicate", "second private body", 2),
      message("other", "third private body", 3)
    ];

    let caught: unknown;
    try {
      assertUniqueMessageIds(messages);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Cannot compress transcript with 1 duplicate message ID");
    expect((caught as Error).message).not.toContain("first private body");
    expect((caught as Error).message).not.toContain("second private body");
  });

  test("accepts an empty list and unique message IDs", () => {
    expect(() => assertUniqueMessageIds([])).not.toThrow();
    expect(() => assertUniqueMessageIds([
      message("first", "body one", 1),
      message("second", "body two", 2)
    ])).not.toThrow();
  });
});

function message(id: string, content: string, sourceLine: number): NormalizedMessage {
  return {
    id,
    role: "assistant",
    content,
    source: "claude-code-jsonl",
    sourceLine,
    rawLine: "{}",
    raw: {}
  };
}
