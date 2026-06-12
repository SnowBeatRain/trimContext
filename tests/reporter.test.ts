import { describe, expect, test } from "vitest";
import { createReport } from "../src/core/reporter.js";
import { LocalHeuristicTokenizer } from "../src/core/tokenizer.js";
import type { NormalizedMessage, Reason } from "../src/types/message.js";

function analyzedMessage(id: string, reasons: Reason[]): NormalizedMessage {
  const tokenizer = new LocalHeuristicTokenizer();
  const tokenMetadata = tokenizer.analyzeMessage(id);
  return {
    id,
    role: "assistant",
    content: id,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    rawLine: "{}",
    raw: {},
    tokens: tokenMetadata.estimated_tokens,
    token_metadata: tokenMetadata,
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

  test("warns when Claude Code input contains an away_summary compact signal", () => {
    const message = analyzedMessage("m1", ["old_message"]);
    const report = createReport(
      [
        {
          ...message,
          source: "claude-code-jsonl",
          raw: {
            type: "system",
            subtype: "away_summary"
          }
        }
      ],
      "session.jsonl"
    );

    expect(report.warnings.join("\n")).toContain("session_compacted");
    expect(report.warnings.join("\n")).toContain("away_summary");
  });

  test("warns for compact_boundary signals", () => {
    const message = analyzedMessage("m1", ["old_message"]);
    const report = createReport(
      [
        {
          ...message,
          source: "claude-code-jsonl",
          raw: {
            type: "system",
            subtype: "compact_boundary"
          }
        }
      ],
      "session.jsonl"
    );

    expect(report.warnings.join("\n")).toContain("session_compacted");
    expect(report.warnings.join("\n")).toContain("compact_boundary");
  });

  test("includes analysis warnings for approximate tokens and report-only compression candidates", () => {
    const candidate = analyzedMessage("m1", ["old_message"]);
    candidate.decision = "compress_candidate";

    const report = createReport([candidate], "session.jsonl");

    expect(report.warnings.join("\n")).toContain(
      "Token counts are approximate local estimates, not model-specific tokenizer counts."
    );
    expect(report.warnings.join("\n")).toContain(
      "compress_candidate messages are report-only in this version and are kept during compression."
    );
  });

  test("includes score diagnostics for threshold tuning without changing decisions", () => {
    const keep = analyzedMessage("m1", ["old_message"]);
    keep.decision = "keep";
    keep.rot_score = 0.42;
    keep.scores = { ...keep.scores, rot_score: 0.42 };

    const reportOnly = analyzedMessage("m2", ["old_message"]);
    reportOnly.decision = "compress_candidate";
    reportOnly.protected = true;
    reportOnly.rot_score = 0.79;
    reportOnly.scores = { ...reportOnly.scores, rot_score: 0.79 };

    const removable = analyzedMessage("m3", ["old_message"]);
    removable.rot_score = 0.86;
    removable.scores = { ...removable.scores, rot_score: 0.86 };

    const report = createReport([keep, reportOnly, removable], "session.jsonl");

    expect(report.summary.score_diagnostics).toEqual({
      max_rot_score: 0.86,
      p90_rot_score: 0.86,
      near_remove_threshold_count: 1,
      protected_high_rot_count: 1,
      decision_score_ranges: {
        keep: { count: 1, min: 0.42, max: 0.42, avg: 0.42 },
        keep_protected: { count: 0, min: 0, max: 0, avg: 0 },
        compress_candidate: { count: 1, min: 0.79, max: 0.79, avg: 0.79 },
        remove_candidate: { count: 1, min: 0.86, max: 0.86, avg: 0.86 }
      }
    });
    expect(report.remove_candidates).toHaveLength(1);
  });

  test("returns no compact-signal warnings when input has no compact signals", () => {
    const report = createReport([analyzedMessage("m1", ["old_message"])], "session.jsonl");
    expect(report.warnings.join("\n")).not.toContain("session_compacted");
  });

  test("includes tokenizer metadata, token breakdown, and context pressure", () => {
    const candidate = analyzedMessage("m1", ["old_message"]);
    candidate.content = "const answer = {\"ok\": true}\n路径 /tmp/session.jsonl";
    const tokenizer = new LocalHeuristicTokenizer();
    const tokenMetadata = tokenizer.analyzeMessage(candidate.content);
    candidate.tokens = tokenMetadata.estimated_tokens;
    candidate.token_metadata = tokenMetadata;

    const report = createReport([candidate], "session.jsonl");

    expect(report.messages[0].token_metadata).toMatchObject({
      estimator: "local_heuristic",
      estimator_version: "approx-v1",
      estimated: true,
      confidence: "medium",
      message_overhead_tokens: 4
    });
    expect(report.summary.token_estimation).toMatchObject({
      estimator: "local_heuristic",
      estimated: true
    });
    expect(report.summary.token_breakdown.code_like_segments).toBeGreaterThan(0);
    expect(report.summary.token_breakdown.json_like_segments).toBeGreaterThan(0);
    expect(report.summary.token_breakdown.path_like_segments).toBeGreaterThan(0);
    expect(report.summary.context_pressure).toMatchObject({
      estimated_total_tokens: candidate.tokens,
      estimated_removable_tokens: candidate.tokens,
      pressure_level: "medium"
    });
  });
});
