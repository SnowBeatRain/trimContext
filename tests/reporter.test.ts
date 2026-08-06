import { describe, expect, test } from "vitest";
import { analyzeMessages } from "../src/core/analyzer.js";
import { createAnalysisWarnings } from "../src/core/diagnostics.js";
import { createReport } from "../src/core/reporter.js";
import { LocalHeuristicTokenizer } from "../src/core/tokenizer.js";
import type { NormalizedMessage, Reason, TokenMetadata } from "../src/types/message.js";

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
    reasons,
    analysis: {
      kind: "metadata",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: [{
        code: "low_value_metadata",
        confidence: "high",
        message_id: id,
        source_line: Number(id.replace(/\D/g, "")) || 1,
        role: "assistant",
        details: { strength: 0.9 }
      }]
    }
  };
}

describe("createReport", () => {
  test("assembles an auditable v2 report without executing compression", () => {
    const duplicate = analyzedMessage("m1", ["duplicate_message"]);
    duplicate.content = "obsolete duplicate output";
    duplicate.analysis = {
      kind: "result",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: [{
        code: "exact_duplicate",
        confidence: "high",
        message_id: "m1",
        source_line: 1,
        role: "assistant",
        related_message_id: "m2",
        related_source_line: 2,
        details: { similarity: 1 }
      }]
    };
    const canonical = analyzedMessage("m2", []);
    canonical.decision = "keep";
    canonical.rot_score = 0;
    canonical.scores = { ...canonical.scores, rot_score: 0 };
    const protectedHighRot = analyzedMessage("m3", ["contains_user_decision"]);
    protectedHighRot.decision = "keep_protected";
    protectedHighRot.protected = true;
    protectedHighRot.rot_score = 0.7;
    protectedHighRot.scores = { ...protectedHighRot.scores, rot_score: 0.7 };

    const report = createReport([duplicate, canonical, protectedHighRot], "session.jsonl");
    const messageIds = new Set(report.messages.map((message) => message.id));

    expect(report.schema_version).toBe("trimctx.report.v2");
    expect(report.compress_candidates).toEqual([]);
    expect(report.candidate_groups).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "exact_duplicate",
      type: "duplicate",
      related_message_id: "m2",
      member_message_ids: ["m1"],
      tokens: duplicate.tokens
    })]));
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.findings.flatMap((finding) => finding.evidence).every((item) => messageIds.has(item.message_id))).toBe(true);
    expect(report.review_queue.items.map((item) => item.message_id)).toEqual(["m1", "m3"]);
    expect(report.review_queue.items[0]?.evidence.length).toBeGreaterThan(0);
    expect(report.review_queue.items[1]?.default_action).toBe("keep_and_review");
    expect(report.assessment).toMatchObject({
      status: "degraded",
      confidence: "medium",
      limitations: expect.arrayContaining(["sample_too_short"])
    });
    expect(report.recommendations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "clarify_continuation",
      "review_then_compress"
    ]));
    expect(report.recommendations.find((item) => item.code === "write_report")).toBeUndefined();
    expect(report.analysis_meta).toMatchObject({
      analyzer_version: "evidence-v2",
      thresholds: { recent_window: 30, remove: 0.8, compress: 0.6 },
      tokenizer: "local_heuristic",
      confidence: "medium"
    });

    const duplicateFinding = report.findings.find((finding) => finding.code === "exact_duplicate");
    expect(duplicateFinding).toMatchObject({
      confidence: "high",
      title: expect.any(String),
      explanation: expect.any(String),
      impact: {
        message_count: 1,
        tokens: duplicate.tokens,
        token_ratio: Number((duplicate.tokens / report.summary.total_tokens).toFixed(4))
      },
      suggested_action: expect.any(String)
    });
    expect(report.findings.find((finding) => finding.type === "limitation")).toMatchObject({
      confidence: "low",
      title: expect.any(String),
      explanation: expect.any(String),
      impact: { message_count: 0, tokens: 0, token_ratio: 0 },
      suggested_action: expect.any(String)
    });
  });

  test("aggregates candidate groups into risk-ranked signal findings", () => {
    const removable = analyzedMessage("m1", ["duplicate_message"]);
    removable.analysis = analysisEvidence("m1", "exact_duplicate", "m4", "high");

    const keptDuplicate = keptMessage("m2");
    keptDuplicate.analysis = {
      ...analysisEvidence("m2", "exact_duplicate", "m5", "high"),
      evidence: [
        ...analysisEvidence("m2", "exact_duplicate", "m5", "high").evidence,
        ...analysisEvidence("m2", "exact_duplicate", "m6", "high").evidence
      ]
    };

    const keptSimilar = keptMessage("m3");
    keptSimilar.analysis = analysisEvidence("m3", "similar_duplicate", "m6", "high");

    const canonicalExact = keptMessage("m4");
    const canonicalSecond = keptMessage("m5");
    const canonicalSimilar = keptMessage("m6");

    const compressibleTool = analyzedMessage("m7", ["orphan_tool_result"]);
    compressibleTool.decision = "compress_candidate";
    compressibleTool.rot_score = 0.7;
    compressibleTool.scores = { ...compressibleTool.scores!, rot_score: 0.7 };
    compressibleTool.analysis = analysisEvidence("m7", "obsolete_tool_output", undefined, "medium");

    const report = createReport([
      removable,
      keptDuplicate,
      keptSimilar,
      canonicalExact,
      canonicalSecond,
      canonicalSimilar,
      compressibleTool
    ], "session.jsonl");
    const signalFindings = report.findings.filter(finding => finding.type !== "limitation");
    const duplicateFindings = signalFindings.filter(finding => finding.code === "exact_duplicate");

    expect(report.candidate_groups.filter(group => group.code === "exact_duplicate")).toHaveLength(3);
    expect(duplicateFindings).toHaveLength(1);
    expect(duplicateFindings[0]).toMatchObject({
      severity: "critical",
      impact: {
        message_count: 2,
        tokens: removable.tokens! + keptDuplicate.tokens!
      }
    });
    expect(duplicateFindings[0]?.evidence).toHaveLength(3);
    expect(signalFindings.find(finding => finding.code === "obsolete_tool_output")?.severity).toBe("warning");
    expect(signalFindings.find(finding => finding.code === "similar_duplicate")?.severity).toBe("info");
    expect(signalFindings.map(finding => finding.code)).toEqual([
      "exact_duplicate",
      "obsolete_tool_output",
      "similar_duplicate"
    ]);
  });

  test("rejects a remove candidate without decisive evidence", () => {
    const invalid = analyzedMessage("m9", ["old_message"]);
    invalid.analysis = {
      kind: "unknown",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: []
    };

    expect(() => createReport([invalid], "session.jsonl")).toThrow(/decisive evidence/i);
  });

  test.each([
    {
      name: "medium-confidence decisive evidence",
      mutate: (candidate: NormalizedMessage) => {
        candidate.reasons = ["duplicate_message"];
        candidate.analysis!.evidence = [{
          code: "similar_duplicate",
          confidence: "medium",
          message_id: candidate.id,
          source_line: candidate.sourceLine,
          role: candidate.role,
          details: { similarity: 0.9 }
        }];
      },
      error: /high-confidence decisive evidence/i
    },
    {
      name: "protected message",
      mutate: (candidate: NormalizedMessage) => {
        candidate.protected = true;
        candidate.reasons = ["duplicate_message"];
        candidate.analysis!.evidence = [{
          code: "exact_duplicate",
          confidence: "high",
          message_id: candidate.id,
          source_line: candidate.sourceLine,
          role: candidate.role,
          details: { similarity: 1 }
        }];
      },
      error: /must not be protected/i
    },
    {
      name: "empty reasons",
      mutate: (candidate: NormalizedMessage) => {
        candidate.reasons = [];
      },
      error: /at least one reason/i
    }
  ])("rejects remove candidate with $name", ({ mutate, error }) => {
    const invalid = analyzedMessage("m10", ["low_value_metadata"]);
    mutate(invalid);

    expect(() => createReport([invalid], "session.jsonl")).toThrow(error);
  });

  test("rejects a compress candidate without reasons", () => {
    const invalid = analyzedMessage("m11", []);
    invalid.decision = "compress_candidate";
    invalid.analysis = analysisEvidence("m11", "obsolete_tool_output", undefined, "medium");

    expect(() => createReport([invalid], "session.jsonl")).toThrow(
      /compress_candidate .* at least one reason/i
    );
  });

  test("keeps real analyzer remove candidates backed by decisive evidence", () => {
    const first = analyzedMessage("m1", []);
    first.content = "repeatable historical status output";
    const second = analyzedMessage("m2", []);
    second.content = "repeatable historical status output";
    const report = createReport(
      analyzeMessages([first, second], { recentWindow: 0 }),
      "session.jsonl",
      { recentWindow: 0 }
    );
    const decisiveCodes = new Set([
      "low_value_metadata",
      "exact_duplicate",
      "superseded",
      "obsolete_tool_output",
      "similar_duplicate",
      "orphan_tool_result"
    ]);

    expect(report.review_queue.items.some((item) => item.decision === "remove_candidate")).toBe(true);
    expect(report.review_queue.items
      .filter((item) => item.decision === "remove_candidate")
      .every((item) => item.evidence.some((entry) => decisiveCodes.has(entry.code)))).toBe(true);
  });

  test("uses a conservative analysis fallback for messages without context", () => {
    const noContext = analyzedMessage("m1", ["old_message"]);
    noContext.decision = "keep";
    noContext.analysis = undefined;
    const report = createReport([noContext], "session.jsonl");

    expect(report.messages[0]?.analysis).toEqual({
      kind: "unknown",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: []
    });
  });

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
    message.token_metadata = exactTokenMetadata();
    message.tokens = message.token_metadata.estimated_tokens;
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
    expect(report.assessment.dimensions.observability).toMatchObject({
      level: "medium",
      score: 0.5,
      evidence_count: 1
    });
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

  test("keeps analysis warnings scoped to tokenization and candidate behavior", () => {
    const message = analyzedMessage("m1", ["old_message"]);
    message.source = "claude-code-jsonl";
    message.raw = { type: "system", subtype: "away_summary" };
    message.token_metadata = exactTokenMetadata();
    message.tokens = message.token_metadata.estimated_tokens;

    expect(createAnalysisWarnings([message])).toEqual([]);
  });

  test("does not warn for OpenAI records that only resemble compact markers", () => {
    const message = analyzedMessage("m1", ["old_message"]);
    const report = createReport([
      {
        ...message,
        source: "openai-jsonl",
        raw: { type: "system", subtype: "away_summary" }
      }
    ], "session.jsonl");

    expect(report.warnings.join("\n")).not.toContain("session_compacted");
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
    expect(report.assessment.dimensions.observability).toMatchObject({
      level: "medium",
      score: 0.5,
      evidence_count: 1
    });
  });

  test("keeps report-only compression notices out of observability evidence", () => {
    const candidate = analyzedMessage("m1", ["old_message"]);
    candidate.decision = "compress_candidate";
    candidate.token_metadata = exactTokenMetadata();
    candidate.tokens = candidate.token_metadata.estimated_tokens;

    const report = createReport([candidate], "session.jsonl");

    expect(report.warnings).toContain(
      "compress_candidate messages are report-only in this version and are kept during compression."
    );
    expect(report.assessment.dimensions.observability).toMatchObject({
      level: "low",
      score: 0,
      evidence_count: 0
    });
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

  test("marks Phase 0 trust as unlocked until manual review metrics are supplied", () => {
    const removable = analyzedMessage("m1", ["old_message"]);
    const protectedMessage = analyzedMessage("m2", ["contains_user_decision"]);
    protectedMessage.decision = "keep_protected";
    protectedMessage.protected = true;
    protectedMessage.rot_score = 0.15;
    protectedMessage.scores = { ...protectedMessage.scores, rot_score: 0.15 };

    const report = createReport([removable, protectedMessage], "session.jsonl");

    expect(report.phase0_trust).toEqual({
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
      notes: [
        "Phase 0 trust is not locked until manual labels are reviewed.",
        "remove_candidate and compress_candidate are review-only recommendations, not automatic deletion approval."
      ]
    });
    expect(report.parser_diagnostics).toEqual({
      source: "openai-jsonl",
      parsed_messages: 2,
      source_lines: { min: 1, max: 2 },
      role_counts: { assistant: 2 },
      empty_content_messages: 0,
      missing_timestamp_messages: 2
    });
  });

  test("returns no compact-signal warnings when input has no compact signals", () => {
    const report = createReport([analyzedMessage("m1", ["old_message"])], "session.jsonl");
    expect(report.warnings.join("\n")).not.toContain("session_compacted");
  });

  test("does not warn about approximate tokens when all messages use exact tokenization", () => {
    const candidate = analyzedMessage("m1", ["old_message"]);
    candidate.token_metadata = exactTokenMetadata();
    candidate.tokens = 8;

    const report = createReport([candidate], "session.jsonl");

    expect(report.tokenization).toEqual({ tokenizer: "tiktoken", confidence: "high" });
    expect(report.summary.token_estimation).toMatchObject({
      estimator: "tiktoken",
      estimated: false,
      note: "Model-specific tokenizer count."
    });
    expect(report.warnings.join("\n")).not.toContain("Token counts are approximate");
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

function keptMessage(id: string): NormalizedMessage {
  const message = analyzedMessage(id, []);
  message.decision = "keep";
  message.rot_score = 0;
  message.scores = { ...message.scores!, rot_score: 0 };
  message.analysis = {
    kind: "unknown",
    turn: 0,
    segment: 0,
    stable_identifiers: [],
    evidence: []
  };
  return message;
}

function analysisEvidence(
  messageId: string,
  code: NonNullable<NormalizedMessage["analysis"]>["evidence"][number]["code"],
  relatedMessageId: string | undefined,
  confidence: NonNullable<NormalizedMessage["analysis"]>["evidence"][number]["confidence"]
): NonNullable<NormalizedMessage["analysis"]> {
  return {
    kind: "result",
    turn: 0,
    segment: 0,
    stable_identifiers: [],
    evidence: [{
      code,
      confidence,
      message_id: messageId,
      source_line: Number(messageId.replace(/\D/g, "")) || 1,
      role: "assistant",
      ...(relatedMessageId ? { related_message_id: relatedMessageId } : {}),
      details: {}
    }]
  };
}

function exactTokenMetadata(): TokenMetadata {
  return {
    estimator: "tiktoken",
    estimator_version: "tiktoken-v1",
    estimated: false,
    confidence: "high",
    estimated_tokens: 8,
    message_overhead_tokens: 4,
    breakdown: {
      cjk_chars: 0,
      ascii_tokens: 0,
      latin_words: 1,
      numbers: 0,
      symbols: 0,
      whitespace_runs: 0,
      code_like_segments: 0,
      path_like_segments: 0,
      json_like_segments: 0,
      line_count: 1,
      char_count: 4
    }
  };
}
