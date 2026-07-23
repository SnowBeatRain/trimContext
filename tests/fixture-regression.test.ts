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
  test("keeps report v2 evidence references valid on realistic fixtures", async () => {
    const report = await reportForFixture("tests/fixtures/codex-realistic.jsonl");
    const messageIds = new Set(report.messages.map((message) => message.id));

    expect(report.schema_version).toBe("trimctx.report.v2");
    expect(report.review_queue.items.flatMap((item) => item.evidence).every((item) => messageIds.has(item.message_id))).toBe(true);
    expect(report.candidate_groups.flatMap((group) => group.evidence).every((item) => messageIds.has(item.message_id))).toBe(true);
  });

  test("surfaces protected high-rot fixture evidence as attention", async () => {
    const file = "tests/fixtures/claude-protected-high-rot.jsonl";
    const input = await readFile(file, "utf8");
    const messages = parseJsonl(input, file);
    const report = createReport(analyzeMessages(messages, { recentWindow: 0 }), file, { recentWindow: 0 });

    expect(report.assessment.status).toBe("attention");
    expect(report.summary.score_diagnostics.protected_high_rot_count).toBeGreaterThan(0);
    expect(report.review_queue.items.some((item) => item.protected && item.default_action === "keep_and_review")).toBe(true);
  });

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
