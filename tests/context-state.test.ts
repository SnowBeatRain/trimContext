import { describe, expect, test } from "vitest";
import { formatContextState, injectContextStateSection } from "../src/core/context-state.js";
import type { AnalysisReport } from "../src/types/report.js";

const STATE_START = "<!-- TRIMCTX_STATE_START -->";
const STATE_END = "<!-- TRIMCTX_STATE_END -->";
const AMBIGUOUS_MARKERS_ERROR = "CLAUDE.md contains ambiguous trimctx state markers";

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
    tokenization: {
      tokenizer: "local_heuristic",
      confidence: "medium"
    },
    phase0_trust: {
      status: "review_required",
      metrics: {
        critical_false_deletion: null,
        protected_recall: null,
        remove_candidate_precision: null
      },
      gates: {
        critical_false_deletion: 0,
        protected_recall: 1,
        remove_candidate_precision: 0.7
      },
      notes: []
    },
    parser_diagnostics: {
      source: "claude-code-jsonl",
      parsed_messages: 100,
      source_lines: { min: 1, max: 120 },
      role_counts: {
        system: 4,
        user: 38,
        assistant: 40,
        tool: 18
      },
      empty_content_messages: 2,
      missing_timestamp_messages: 7
    },
    resume: {
      currentGoal: { text: "继续 trimctx Phase 0 验证", messageId: "m0", sourceLine: 10, role: "user" },
      decisions: [
        { text: "compress_candidate 仅报告", messageId: "m1", sourceLine: 12, role: "assistant" }
      ],
      activeFiles: [
        { path: "src/core/context-state.ts", messageId: "m2", sourceLine: 42 }
      ],
      failures: [],
      testSignals: [
        { text: "npm test", messageId: "m3", sourceLine: 80, role: "assistant" }
      ],
      nextSteps: [
        { text: "补充状态块明细", messageId: "m4", sourceLine: 90, role: "assistant" }
      ],
      readiness: {
        level: "ready",
        score: 85,
        missing: [],
        signals: {
          current_goal: true,
          decisions: true,
          active_files: true,
          failures: false,
          test_signals: true,
          next_steps: true
        }
      }
    },
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

  test("includes parser, tokenizer, decision, trust, and next action details", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("来源：claude-code-jsonl");
    expect(result).toContain("解析：100 条，行 1-120");
    expect(result).toContain("角色：system 4 / user 38 / assistant 40 / tool 18");
    expect(result).toContain("Token：local_heuristic / medium / 估算");
    expect(result).toContain("保护：80 条 / ~47.5K tokens / 95.0%");
    expect(result).toContain("候选：remove 10 / compress 5 / near-threshold 2 / protected-high-rot 3");
    expect(result).toContain("分数：max 0.900 / p90 0.800");
    expect(result).toContain("信任：Phase0 review_required");
    expect(result).toContain("续接：READY 85/100");
    expect(result).toContain("建议：先运行 `trimctx report` 审查 remove_candidate；compress_candidate 默认保留。");
  });

  test("includes timestamp", () => {
    const report = makeReport();
    const result = formatContextState(report);

    expect(result).toContain("更新：");
  });

  test("renders transcript-derived goals as bounded marker-safe redacted text", () => {
    const report = makeReport();
    report.resume.currentGoal = {
      ...report.resume.currentGoal!,
      text: `目标：第一行\n第二行 ${STATE_START} ${STATE_END} ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890 Authorization: Bearer hook-secret-value ${"x".repeat(300)}`
    };

    const result = formatContextState(report);
    const goalLine = result.split("\n").find(line => line.startsWith("- 续接："));
    const goalText = goalLine?.split("，目标 ")[1];

    expect(result.split(STATE_START)).toHaveLength(2);
    expect(result.split(STATE_END)).toHaveLength(2);
    expect(result.match(/\[trimctx marker omitted\]/g) ?? []).toHaveLength(2);
    expect(result).toContain("Authorization: Bearer [REDACTED]");
    expect(result).not.toContain("hook-secret-value");
    expect(result).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD");
    expect(result).not.toContain("github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890");
    expect(goalLine).toContain("第二行");
    expect(goalText).toBeDefined();
    expect(goalText!.length).toBeLessThanOrEqual(220);
  });

  test("renders a whitespace-only current goal as unidentified", () => {
    const report = makeReport();
    report.resume.currentGoal = {
      ...report.resume.currentGoal!,
      text: "\u0000\t\r\n "
    };

    expect(formatContextState(report)).toContain("，目标 未识别");
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

  test("preserves every byte outside a replaced managed section", () => {
    const content = `prefix \t\n${STATE_START}\nold\n${STATE_END}\n\n suffix  \n\n`;
    const section = `${STATE_START}\nnew\n${STATE_END}`;

    expect(injectContextStateSection(content, section)).toBe(
      `prefix \t\n${STATE_START}\nnew\n${STATE_END}\n\n suffix  \n\n`
    );
  });

  test("preserves every byte outside a removed managed section", () => {
    const content = `prefix \t\n${STATE_START}\nold\n${STATE_END}\n\n suffix  \n\n`;

    expect(injectContextStateSection(content, "")).toBe("prefix \t\n\n\n suffix  \n\n");
  });

  test.each([
    ["lone start marker", `${STATE_START}\nold`],
    ["lone end marker", `old\n${STATE_END}`],
    ["reversed markers", `${STATE_END}\nuser content\n${STATE_START}`],
    ["duplicate start markers", `${STATE_START}\n${STATE_START}\nold\n${STATE_END}`],
    ["duplicate end markers", `${STATE_START}\nold\n${STATE_END}\n${STATE_END}`],
    ["multiple managed sections", `${STATE_START}\none\n${STATE_END}\n${STATE_START}\ntwo\n${STATE_END}`]
  ])("rejects %s for replacement and removal", (_name, content) => {
    const section = `${STATE_START}\nnew\n${STATE_END}`;

    expect(() => injectContextStateSection(content, section)).toThrow(AMBIGUOUS_MARKERS_ERROR);
    expect(() => injectContextStateSection(content, "")).toThrow(AMBIGUOUS_MARKERS_ERROR);
  });
});
