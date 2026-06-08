import { describe, expect, test } from "vitest";
import { parseOpenAiJsonl } from "../src/adapters/openai-jsonl.js";

describe("OpenAI JSONL parser", () => {
  test("normalizes messages arrays and single-message jsonl rows", () => {
    const input = [
      '{"messages":[{"role":"system","content":"Rules"},{"role":"user","content":[{"type":"text","text":"Hi"}]},{"role":"assistant","content":"Hello"}]}',
      '{"role":"developer","content":"Keep this"}'
    ].join("\n");

    const messages = parseOpenAiJsonl(input, "chat.jsonl");

    expect(messages).toHaveLength(4);
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "developer"
    ]);
    expect(messages[1].content).toBe("Hi");
    expect(messages[3]).toMatchObject({
      id: "chat.jsonl:2",
      source: "openai-jsonl",
      sourceLine: 2,
      content: "Keep this"
    });
  });
});
