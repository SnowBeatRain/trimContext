import { describe, expect, test } from "vitest";
import { formatAnalysisSummary } from "../src/cli/format-summary.js";
import type { AnalysisReport } from "../src/types/report.js";

function scoreRange(count: number, score: number): { count: number; min: number; max: number; avg: number } {
  return { count, min: score, max: score, avg: score };
}

function reportWithPhase0Trust(status: AnalysisReport["phase0_trust"]["status"]): AnalysisReport {
  return {
    schema_version: "trimctx.report.v1",
    input: {
      file: "session.jsonl",
      source: "claude-code-jsonl"
    },
    summary: {
      total_messages: 2,
      total_tokens: 100,
      protected_messages: 1,
      compress_candidates: 1,
      remove_candidates: 0,
      estimated_saving_tokens: 0,
      estimated_saving_ratio: 0,
      token_estimation: {
        estimator: "local_heuristic",
        estimator_version: "heuristic-v1",
        estimated: true,
        confidence: "medium",
        note: "local estimate"
      },
      token_breakdown: {
        cjk_chars: 0,
        ascii_tokens: 100,
        code_like_segments: 0,
        json_like_segments: 0
      },
      context_pressure: {
        estimated_total_tokens: 100,
        estimated_removable_tokens: 0,
        estimated_protected_tokens: 20,
        remove_candidate_ratio: 0,
        protected_token_ratio: 0.2,
        pressure_level: "low"
      },
      top_reasons: [],
      score_diagnostics: {
        max_rot_score: 0.62,
        p90_rot_score: 0.62,
        near_remove_threshold_count: 0,
        protected_high_rot_count: 0,
        decision_score_ranges: {
          keep: scoreRange(1, 0.1),
          keep_protected: scoreRange(0, 0),
          compress_candidate: scoreRange(1, 0.62),
          remove_candidate: scoreRange(0, 0)
        }
      }
    },
    tokenization: {
      tokenizer: "local_heuristic",
      confidence: "medium"
    },
    phase0_trust: {
      status,
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
      notes: ["Manual review metrics are not supplied yet."]
    },
    parser_diagnostics: {
      source: "claude-code-jsonl",
      parsed_messages: 2,
      source_lines: { min: 1, max: 2 },
      role_counts: { user: 1, assistant: 1 },
      empty_content_messages: 0,
      missing_timestamp_messages: 0
    },
    resume: {
      readiness: { score: 0, level: "blocked", reasons: [] },
      currentGoal: undefined,
      decisions: [],
      activeFiles: [],
      failures: [],
      testSignals: [],
      nextSteps: [],
      evidence: []
    },
    messages: [],
    remove_candidates: [],
    warnings: []
  };
}

describe("formatAnalysisSummary", () => {
  test("shows Phase 0 trust state and review-only candidates", () => {
    const summary = formatAnalysisSummary(reportWithPhase0Trust("review_required"));

    expect(summary).toContain("phase0: REVIEW_REQUIRED");
    expect(summary).toContain("candidates are review-only until Phase 0 gates are locked.");
    expect(summary).toContain("compress candidates, if any, are report-only and kept by default.");
  });
});
