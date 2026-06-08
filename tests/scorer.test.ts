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

describe("scorer", () => {
  test("computes deterministic rot scores, decisions, and reasons", () => {
    const base = [
      message("m1", "assistant", "Use old payment endpoint legacy charge api"),
      message("m2", "assistant", "Use old payment endpoint legacy charge api"),
      { ...message("m3", "tool", "large unused output"), tool: { isToolResult: true, toolResultFor: "missing-tool" } },
      message("m4", "user", "Correction: instead use new billing endpoint"),
      message("m5", "assistant", "Okay use new billing endpoint"),
      message("m6", "user", "recent one"),
      message("m7", "assistant", "recent one answer"),
      message("m8", "user", "recent two"),
      message("m9", "assistant", "recent two answer"),
      message("m10", "user", "recent three"),
      message("m11", "assistant", "recent three answer"),
      message("m12", "user", "recent four"),
      message("m13", "assistant", "recent four answer"),
      message("m14", "user", "recent five"),
      message("m15", "assistant", "recent five answer"),
      message("m16", "user", "recent six"),
      message("m17", "assistant", "recent six answer")
    ];

    const analyzed = analyzeMessages(base);
    const first = analyzed[0]!;
    const orphanTool = analyzed[2]!;
    const last = analyzed[16]!;

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
      message("m5", "user", "recent one"),
      message("m6", "assistant", "recent one answer"),
      message("m7", "user", "recent two"),
      message("m8", "assistant", "recent two answer"),
      message("m9", "user", "recent three"),
      message("m10", "assistant", "recent three answer"),
      message("m11", "user", "recent four"),
      message("m12", "assistant", "recent four answer"),
      message("m13", "user", "recent five"),
      message("m14", "assistant", "recent five answer"),
      message("m15", "user", "recent six"),
      message("m16", "assistant", "recent six answer")
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
