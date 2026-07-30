import { describe, expect, test } from "vitest";
import { analyzeMessages } from "../src/core/analyzer.js";
import { scoreMessages } from "../src/core/scorer.js";
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
  test("uses a valid evidence details strength for metadata scores", () => {
    const scored = scoreMessages([
      { ...message("m1", "unknown", "[last-prompt] payload"), analysis: { kind: "metadata", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "low_value_metadata", confidence: "medium", message_id: "m1", source_line: 1, role: "unknown", details: { strength: 0.65 } }] } },
      { ...message("m2", "unknown", "[mode] payload"), analysis: { kind: "metadata", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "low_value_metadata", confidence: "high", message_id: "m2", source_line: 2, role: "unknown", details: { strength: 0.9 } }] } }
    ], { removeThreshold: 0.8, compressThreshold: 0.6 });

    expect(scored.map((entry) => [entry.scores?.low_value_score, entry.scores?.rot_score])).toEqual([[0.65, 0.65], [0.9, 0.9]]);
  });
  test("uses high decisive evidence for removal and never promotes support-only evidence", () => {
    const base = [
      {
        ...message("m1", "assistant", "old duplicate"),
        analysis: { kind: "result", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "exact_duplicate", confidence: "high", message_id: "m1", source_line: 1, role: "assistant", related_message_id: "m2", related_source_line: 2, details: {} }] }
      },
      {
        ...message("m2", "assistant", "support only"),
        analysis: { kind: "result", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "old_message", confidence: "low", message_id: "m2", source_line: 2, role: "assistant", details: {} }] }
      },
      {
        ...message("m3", "tool", "obsolete output"),
        analysis: { kind: "tool_result", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "obsolete_tool_output", confidence: "medium", message_id: "m3", source_line: 3, role: "tool", details: {} }] }
      }
    ];

    const scored = scoreMessages(base, { removeThreshold: 0.8, compressThreshold: 0.6 });

    expect(scored[0]).toMatchObject({ decision: "remove_candidate", reasons: ["duplicate_message"] });
    expect(scored[0]?.scores?.rot_score).toBeGreaterThanOrEqual(0.8);
    expect(scored[1]).toMatchObject({ decision: "keep" });
    expect(scored[2]).toMatchObject({ decision: "compress_candidate", reasons: ["obsolete_tool_output"] });
  });
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
    expect(first.reasons).toContain("duplicate_message");
    expect(first.reasons!.length).toBeGreaterThan(0);
    expect(orphanTool.scores!.orphan_tool_score).toBeGreaterThan(0);
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

  test("allows callers to tune recent window and decision thresholds", () => {
    const base = [
      message("m1", "assistant", "Use old payment endpoint legacy charge api"),
      message("m2", "assistant", "Use old payment endpoint legacy charge api"),
      { ...message("m3", "tool", "large unused output"), tool: { isToolResult: true, toolResultFor: "missing-tool" } },
      message("m4", "user", "Correction: instead use new billing endpoint"),
      message("m5", "assistant", "Okay use new billing endpoint"),
      ...padding(30)
    ];

    const defaultAnalyzed = analyzeMessages(base);
    const tunedAnalyzed = analyzeMessages(base, {
      recentWindow: 0,
      removeThreshold: 0.95,
      compressThreshold: 0.5
    });

    expect(defaultAnalyzed.at(-1)?.decision).toBe("keep_protected");
    expect(tunedAnalyzed.at(-1)?.decision).not.toBe("keep_protected");
    expect(defaultAnalyzed[0].decision).toBe("remove_candidate");
    expect(tunedAnalyzed[0].decision).toBe("compress_candidate");
  });
});
