import { describe, expect, test } from "vitest";
import { analyzeMessages } from "../src/core/analyzer.js";
import type { NormalizedMessage } from "../src/types/message.js";

function message(id: string, role: NormalizedMessage["role"], content: string): NormalizedMessage {
  return {
    id,
    role,
    content,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    rawLine: "{}",
    raw: {}
  };
}

function padding(count: number): NormalizedMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `pad${i}`;
    return message(id, i % 2 === 0 ? "user" : "assistant", `padding ${i}`);
  });
}

describe("scorer", () => {
  test("computes deterministic rot scores, decisions, and reasons", () => {
    const base = [
      message("m1", "assistant", "Use old payment endpoint legacy charge api"),
      message("m2", "assistant", "Use old payment endpoint legacy charge api"),
      { ...message("m3", "tool", "large unused output"), tool: { isToolResult: true, toolResultFor: "missing-tool" } },
      message("m4", "user", "Correction: instead use new billing endpoint"),
      message("m5", "assistant", "Okay use new billing endpoint"),
      ...padding(30)
    ];

    const analyzed = analyzeMessages(base);
    const first = analyzed[0]!;
    const orphanTool = analyzed[2]!;
    const last = analyzed[analyzed.length - 1]!;

    expect(first.scores!.rot_score).toBeGreaterThanOrEqual(0.8);
    expect(first.decision).toBe("remove_candidate");
    expect(first.reasons).toContain("superseded_by_later_instruction");
    expect(first.reasons!.length).toBeGreaterThan(0);
    expect(orphanTool.scores!.orphan_tool_score).toBe(1);
    expect(last.decision).toBe("keep_protected");
  });

  test("marks old Claude metadata and large instruction attachments as low-value candidates", () => {
    const largeAttachment = `[attachment] {"type":"mcp_instructions_delta","addedNames":["buddy"],"addedBlocks":["${"repeat low value instructions ".repeat(80)}"]}`;
    const base = [
      message("m1", "unknown", "[file-history-snapshot] {\"trackedFileBackups\":{},\"timestamp\":\"2026-05-26T14:54:01.791Z\"}"),
      message("m2", "unknown", "[ai-title] {\"aiTitle\":\"Old cosmetic title\"}"),
      message("m3", "unknown", largeAttachment),
      message("m4", "assistant", "We later implemented the actual card style."),
      ...padding(30)
    ];

    const analyzed = analyzeMessages(base);
    const lowValue = analyzed.slice(0, 3);

    expect(lowValue.every((item) => item.protected === false)).toBe(true);
    expect(lowValue.map((item) => item.decision)).toEqual([
      "remove_candidate",
      "remove_candidate",
      "compress_candidate"
    ]);
    expect(lowValue.every((item) => item.reasons?.includes("low_value_metadata"))).toBe(true);
  });
});
