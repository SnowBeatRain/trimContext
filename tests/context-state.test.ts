import { describe, expect, test } from "vitest";
import { formatContextState, injectContextStateSection } from "../src/core/context-state.js";
import type { AnalysisReport } from "../src/types/report.js";

function makeReport(overrides: Partial<AnalysisReport["summary"]> = {}): AnalysisReport {
  const summary = {
    total_messages: 100,
    total_tokens: 50000,
    remove_candidates: 10,
    estimated_saving_ratio: 0.05,
    estimated_saving_tokens: 2500,
    protected_messages: 80,
    compress_candidates: 5,
    token_estimation: {
      estimator: "local_heuristic" as const,
      estimator_version: "approx-v1",
      estimated: true,
      confidence: "medium" as const,
      note: ""
    },
    token_breakdown: {
      cjk_chars: 1000,
      ascii_tokens: 49000,
      latin_words: 20000,
      numbers: 5000,
      symbols: 10000,
      whitespace_runs: 14000,
      code_like_segments: 100,
      path_like_segments: 200,
      json_like_segments: 50,
      line_count: 500,
      char_count: 150000
    },
    context_pressure: {
      estimated_total_tokens: 50000,
      estimated_removable_tokens: 2500,
      estimated_protected_tokens: 47500,
      remove_candidate_ratio: 0.05,
      protected_token_ratio: 0.95,
      pressure_level: "medium" as const
    },
    top_reasons: [
      { reason: "low_value_metadata" as const, count: 20 },
      { reason: "old_message" as const, count: 15 },
      { reason: "superseded_by_later_instruction" as const, count: 10 }
    ],
    score_diagnostics: {
      max_rot_score: 0.9,
      p90_rot_score: 0.8,
      near_remove_threshold_count: 2,
      protected_high_rot_count: 3,
      decision_score_ranges: {}
    },
    ...overrides
  };

  return {
    schema_version: "trimctx.report.v1",
    input: { file: "/test/session.jsonl", source: "claude-code-jsonl" },
    summary,
    messages: [],
    remove_candidates: [],
    warnings: []
  };
}

describe("formatContextState", () => {
  test("wraps output in HTML comment markers", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("<!-- TRIMCTX_STATE_START -->");
    expect(result).toContain("<!-- TRIMCTX_STATE_END -->");
  });

  test("includes message count and token estimate", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("100 条");
    expect(result).toContain("50.0K tokens");
  });

  test("includes pressure and health level", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("MEDIUM");
    expect(result).toContain("MODERATE");
  });

  test("includes removable count for non-zero remove candidates", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("10 条");
    expect(result).toContain("2.5K tokens");
  });

  test("omits removable count when zero rot candidates", () => {
    const report = makeReport({ remove_candidates: 0, compress_candidates: 0, estimated_saving_tokens: 0 });
    const result = formatContextState(report);

    expect(result).not.toContain("可移除");
  });

  test("includes top reasons", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("metadata noise(20)");
    expect(result).toContain("old content(15)");
    expect(result).toContain("superseded(10)");
  });

  test("includes timestamp", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("更新：");
  });

  test("shows OK health for low rot rate", () => {
    const report = makeReport({ remove_candidates: 0, compress_candidates: 0 });
    const result = formatContextState(report);

    expect(result).toContain("OK");
  });

  test("shows HEAVY health for high rot rate", () => {
    const report = makeReport({ remove_candidates: 30, compress_candidates: 10 });
    const result = formatContextState(report);

    expect(result).toContain("HEAVY");
  });
});

describe("injectContextStateSection", () => {
  test("appends section to content without markers", () => {
    const content = "# My Project\n\nSome content.\n";
    const section = "<!-- TRIMCTX_STATE_START -->\nstate\n<!-- TRIMCTX_STATE_END -->";

    const result = injectContextStateSection(content, section);

    expect(result).toContain("# My Project");
    expect(result).toContain("<!-- TRIMCTX_STATE_START -->");
    expect(result).toContain("state");
    expect(result).toContain("<!-- TRIMCTX_STATE_END -->");
  });

  test("replaces existing section between markers", () => {
    const content = [
      "# Before",
      "<!-- TRIMCTX_STATE_START -->",
      "old state",
      "<!-- TRIMCTX_STATE_END -->",
      "# After"
    ].join("\n");
    const section = "<!-- TRIMCTX_STATE_START -->\nnew state\n<!-- TRIMCTX_STATE_END -->";

    const result = injectContextStateSection(content, section);

    expect(result).toContain("# Before");
    expect(result).toContain("new state");
    expect(result).toContain("# After");
    expect(result).not.toContain("old state");
  });

  test("removes section when stateSection is empty", () => {
    const content = [
      "# Before",
      "<!-- TRIMCTX_STATE_START -->",
      "old state",
      "<!-- TRIMCTX_STATE_END -->",
      "# After"
    ].join("\n");

    const result = injectContextStateSection(content, "");

    expect(result).toContain("# Before");
    expect(result).toContain("# After");
    expect(result).not.toContain("TRIMCTX_STATE");
    expect(result).not.toContain("old state");
  });

  test("returns content unchanged when removing non-existent section", () => {
    const content = "# No section here\n";

    const result = injectContextStateSection(content, "");

    expect(result).toBe(content);
  });
});
