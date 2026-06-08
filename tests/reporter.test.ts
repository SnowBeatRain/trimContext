import { describe, expect, test } from "vitest";
import { createReport } from "../src/core/reporter.js";
import type { NormalizedMessage, Reason } from "../src/types/message.js";

function analyzedMessage(id: string, reasons: Reason[]): NormalizedMessage {
  return {
    id,
    role: "assistant",
    content: id,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    rawLine: "{}",
    raw: {},
    tokens: 10,
    protected: false,
    decision: "remove_candidate",
    rot_score: 0.9,
    scores: {
      superseded_score: 0,
      low_reference_score: 0,
      age_score: 0,
      redundancy_score: 0,
      orphan_tool_score: 0,
      low_value_score: 0,
      rot_score: 0.9
    },
    reasons
  };
}

describe("createReport", () => {
  test("summarizes top reasons by count", () => {
    const report = createReport(
      [
        analyzedMessage("m1", ["old_message", "duplicate_nearby_message"]),
        analyzedMessage("m2", ["old_message"]),
        analyzedMessage("m3", ["low_reference_in_later_context"])
      ],
      "session.jsonl"
    );

    expect(report.summary.top_reasons).toEqual([
      { reason: "old_message", count: 2 },
      { reason: "duplicate_nearby_message", count: 1 },
      { reason: "low_reference_in_later_context", count: 1 }
    ]);
  });
});
