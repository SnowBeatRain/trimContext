import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { analyzeMessages, parseJsonl } from "../src/core/analyzer.js";
import { createReport } from "../src/core/reporter.js";

async function reportForFixture(file: string) {
  const input = await readFile(file, "utf8");
  const messages = parseJsonl(input, file);
  return createReport(analyzeMessages(messages), file);
}

describe("fixture regression reports", () => {
  test("keeps Claude Code safety signals stable on realistic fixture", async () => {
    const report = await reportForFixture("tests/fixtures/claude-code-realistic.jsonl");

    expect(report.input.source).toBe("claude-code-jsonl");
    expect(report.summary).toMatchObject({
      total_messages: 7,
      remove_candidates: 0,
      protected_messages: 7,
      compress_candidates: 0
    });
    expect(report.messages.map((message) => message.decision)).toEqual(Array(7).fill("keep_protected"));
    expect(report.summary.top_reasons.map((item) => item.reason)).toContain("recent_message");
    expect(report.summary.top_reasons.map((item) => item.reason)).toContain("contains_file_path");
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Token counts are approximate")
    ]));
  });

  test("keeps OpenAI chat fixture report shape stable", async () => {
    const report = await reportForFixture("tests/fixtures/openai-chat.jsonl");

    expect(report.input.source).toBe("openai-jsonl");
    expect(report.summary).toMatchObject({
      total_messages: 4,
      remove_candidates: 0,
      protected_messages: 4,
      compress_candidates: 0
    });
    expect(report.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "developer"
    ]);
    expect(report.messages.every((message) => message.decision === "keep_protected")).toBe(true);
  });
});
