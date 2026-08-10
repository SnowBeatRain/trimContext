import { describe, expect, test } from "vitest";
import {
  confidenceRank,
  highestConfidence,
  toEvidenceRef
} from "../src/core/report-evidence.js";
import {
  createCandidateGroups,
  createFindings
} from "../src/core/report-findings.js";
import {
  createRecommendations,
  createReviewQueue
} from "../src/core/report-review.js";
import { createReport } from "../src/core/reporter.js";
import type { AnalyzedMessage } from "../src/types/report.js";
import type { EvidenceConfidence, SignalCode } from "../src/types/signals.js";

describe("report evidence construction", () => {
  test("normalizes evidence without leaking detector details", () => {
    expect(toEvidenceRef({
      code: "exact_duplicate",
      confidence: "high",
      message_id: "m2",
      source_line: 2,
      role: "assistant",
      related_message_id: "m1",
      related_source_line: 1,
      details: { similarity: 1 }
    })).toEqual({
      message_id: "m2",
      source_line: 2,
      role: "assistant",
      code: "exact_duplicate",
      confidence: "high",
      related_message_id: "m1"
    });
  });

  test("orders confidence and retains the empty fallback", () => {
    const values: EvidenceConfidence[] = ["low", "high", "medium"];

    expect(values.map((value) => confidenceRank(value))).toEqual([1, 3, 2]);
    expect(highestConfidence(values)).toBe("high");
    expect(values).toEqual(["low", "high", "medium"]);
    expect(highestConfidence(["low"])).toBe("low");
    expect(highestConfidence([])).toBe("medium");
  });
});

describe("report finding construction", () => {
  test("builds stable groups and aggregates findings by signal code", () => {
    const messages = [
      analyzedMessage("m1", 1, "remove_candidate", "exact_duplicate", "m4", "high", 10),
      analyzedMessage("m2", 2, "keep", "exact_duplicate", "m5", "medium", 20),
      analyzedMessage("m3", 3, "compress_candidate", "obsolete_tool_output", undefined, "medium", 30),
      analyzedMessage("m4", 4, "keep", undefined, undefined, undefined, 40),
      analyzedMessage("m5", 5, "keep", undefined, undefined, undefined, 50)
    ];

    const groups = createCandidateGroups(messages);
    const findings = createFindings(groups, ["sample_too_short"], messages);

    expect(groups.map((group) => group.id)).toEqual([
      "exact_duplicate:m4",
      "exact_duplicate:m5",
      "obsolete_tool_output:none"
    ]);
    expect(groups[0]).toMatchObject({
      canonical_message_id: "m4",
      member_message_ids: ["m1"],
      tokens: 10
    });
    expect(findings.map((finding) => finding.code)).toEqual([
      "exact_duplicate",
      "obsolete_tool_output",
      "sample_too_short"
    ]);
    expect(findings[0]).toMatchObject({
      severity: "critical",
      confidence: "high",
      impact: { message_count: 2, tokens: 30, token_ratio: 0.2 }
    });
    expect(findings[1]).toMatchObject({
      severity: "warning",
      confidence: "medium"
    });
  });

  test("deduplicates each evidence relationship at its highest confidence", () => {
    const duplicate = analyzedMessage(
      "m1",
      1,
      "keep",
      "exact_duplicate",
      "m2",
      "low",
      10
    );
    duplicate.analysis.evidence.push({
      ...duplicate.analysis.evidence[0]!,
      confidence: "high"
    });

    const groups = createCandidateGroups([
      duplicate,
      analyzedMessage("m2", 2, "keep", undefined, undefined, undefined, 20)
    ]);
    const finding = createFindings(groups, [], [
      duplicate,
      analyzedMessage("m2", 2, "keep", undefined, undefined, undefined, 20)
    ])[0];

    expect(finding?.evidence).toHaveLength(1);
    expect(finding?.evidence[0]).toMatchObject({
      message_id: "m1",
      related_message_id: "m2",
      confidence: "high"
    });
  });
});

describe("report review construction", () => {
  test("builds a risk-ranked redacted review queue", () => {
    const removable = analyzedMessage(
      "m2",
      2,
      "remove_candidate",
      "exact_duplicate",
      "m9",
      "high",
      20
    );
    removable.content = "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890 contact me@example.com with ghp-1234567890abcdef";
    const compressible = analyzedMessage(
      "m1",
      1,
      "compress_candidate",
      "obsolete_tool_output",
      undefined,
      "medium",
      40
    );

    const queue = createReviewQueue([compressible, removable]);

    expect(queue.map((item) => item.message_id)).toEqual(["m2", "m1"]);
    expect(queue[0]).toMatchObject({
      risk: "high",
      default_action: "remove_after_review"
    });
    expect(queue[0]?.summary).toBe("[REDACTED] [REDACTED] contact [REDACTED_EMAIL] with [REDACTED]");
  });

  test("rejects invalid remove candidates through the standalone constructor", () => {
    const invalid = analyzedMessage(
      "m1",
      1,
      "remove_candidate",
      "similar_duplicate",
      "m2",
      "medium",
      10
    );

    expect(() => createReviewQueue([invalid])).toThrow(/high-confidence decisive evidence/i);
  });

  test("constructs unchanged recommendations and quoted commands", () => {
    expect(createRecommendations("C:\\work folder\\a.jsonl", "degraded", {
      score: 100,
      level: "ready",
      missing: [],
      signals: {
        current_goal: true,
        decisions: true,
        active_files: true,
        test_signals: true,
        next_steps: true
      }
    }, 1)).toEqual([
      {
        code: "new_chat",
        priority: 3,
        summary: "Prepare a reviewed continuation package for a new chat.",
        command: "trimctx new-chat \"C:\\work folder\\a.jsonl\""
      },
      {
        code: "review_then_compress",
        priority: 4,
        summary: "Review remove candidates before writing a compressed copy.",
        command: "trimctx compress \"C:\\work folder\\a.jsonl\" -o trimmed.jsonl"
      }
    ]);
  });

  test("names only the continuation evidence that readiness marks missing", () => {
    const recommendations = createRecommendations("session.jsonl", "attention", {
      score: 60,
      level: "partial",
      missing: ["user decisions", "active files", "test signals"],
      signals: {
        current_goal: true,
        decisions: false,
        active_files: false,
        test_signals: false,
        next_steps: true
      }
    }, 0);
    const clarification = recommendations.find(({ code }) => code === "clarify_continuation");

    expect(clarification?.summary).toContain("user decisions, active files, test signals");
    expect(clarification?.summary).not.toContain("current goal");
    expect(clarification?.summary).not.toContain("next step");
  });
});

describe("report construction facade", () => {
  test("assembles the same nested structures as the standalone constructors", () => {
    const messages = [
      analyzedMessage("m1", 1, "remove_candidate", "exact_duplicate", "m3", "high", 10),
      analyzedMessage("m2", 2, "compress_candidate", "obsolete_tool_output", undefined, "medium", 20),
      analyzedMessage("m3", 3, "keep", undefined, undefined, undefined, 30)
    ];
    const report = createReport(
      messages.map((message) => ({ ...message, rawLine: "{}", raw: {} })),
      "session.jsonl"
    );
    const groups = createCandidateGroups(report.messages);

    expect(report.candidate_groups).toEqual(groups);
    expect(report.findings).toEqual(
      createFindings(groups, report.assessment.limitations, report.messages)
    );
    expect(report.review_queue.items).toEqual(createReviewQueue(report.messages));
    expect(report.recommendations).toEqual(createRecommendations(
      "session.jsonl",
      report.assessment.status,
      report.resume.readiness,
      report.remove_candidates.length
    ));
  });
});

function analyzedMessage(
  id: string,
  sourceLine: number,
  decision: AnalyzedMessage["decision"],
  code: SignalCode | undefined,
  relatedMessageId: string | undefined,
  confidence: EvidenceConfidence | undefined,
  tokens: number
): AnalyzedMessage {
  return {
    id,
    role: "assistant",
    content: id,
    source: "openai-jsonl",
    sourceLine,
    tokens,
    protected: false,
    rot_score: decision === "remove_candidate" ? 0.9 : decision === "compress_candidate" ? 0.7 : 0,
    scores: {
      superseded_score: 0,
      low_reference_score: 0,
      age_score: 0,
      redundancy_score: 0,
      orphan_tool_score: 0,
      low_value_score: 0,
      rot_score: decision === "remove_candidate" ? 0.9 : decision === "compress_candidate" ? 0.7 : 0
    },
    decision,
    reasons: decision === "remove_candidate"
      ? ["duplicate_message"]
      : decision === "compress_candidate" ? ["obsolete_tool_output"] : [],
    analysis: {
      kind: code ? "result" : "unknown",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: code && confidence ? [{
        code,
        confidence,
        message_id: id,
        source_line: sourceLine,
        role: "assistant",
        ...(relatedMessageId ? { related_message_id: relatedMessageId } : {}),
        details: {}
      }] : []
    }
  };
}
