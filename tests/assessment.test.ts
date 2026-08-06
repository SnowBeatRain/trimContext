import { describe, expect, test } from "vitest";
import type { AnalyzedMessage } from "../src/types/report.js";
import type { ResumeState } from "../src/types/resume.js";
import type { SignalEvidence } from "../src/types/signals.js";

function message(
  id: string,
  options: Partial<AnalyzedMessage> & { evidence?: SignalEvidence[] } = {}
): AnalyzedMessage {
  const evidence = options.evidence ?? [];
  return {
    id,
    role: "assistant",
    content: `substantive message ${id}`,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    tokens: 100,
    protected: false,
    rot_score: 0,
    scores: {
      superseded_score: 0,
      low_reference_score: 0,
      age_score: 0,
      redundancy_score: 0,
      orphan_tool_score: 0,
      low_value_score: 0,
      rot_score: 0
    },
    decision: "keep",
    reasons: [],
    analysis: {
      kind: "unknown",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence
    },
    ...options,
    analysis: {
      kind: options.analysis?.kind ?? "unknown",
      turn: options.analysis?.turn ?? 0,
      segment: options.analysis?.segment ?? 0,
      stable_identifiers: options.analysis?.stable_identifiers ?? [],
      evidence
    }
  };
}

function evidence(
  messageId: string,
  code: SignalEvidence["code"],
  confidence: SignalEvidence["confidence"] = "high"
): SignalEvidence {
  return {
    code,
    confidence,
    message_id: messageId,
    source_line: Number(messageId.replace(/\D/g, "")) || 1,
    role: "assistant",
    details: {}
  };
}

function resume(level: ResumeState["readiness"]["level"]): ResumeState {
  const ready = level === "ready";
  return {
    currentGoal: ready
      ? { text: "目标：完成报告。", sourceLine: 1, messageId: "m1", role: "user", confidence: "high" }
      : undefined,
    decisions: [],
    activeFiles: [],
    failures: [],
    testSignals: [],
    nextSteps: ready
      ? [{ text: "下一步：验证报告。", sourceLine: 2, messageId: "m2", role: "user", confidence: "high" }]
      : [],
    readiness: {
      score: ready ? 75 : 0,
      level,
      missing: ready ? [] : ["current goal", "next steps"],
      signals: {
        current_goal: ready,
        decisions: false,
        active_files: false,
        test_signals: false,
        next_steps: ready
      }
    }
  };
}

async function assess(messages: AnalyzedMessage[], state = resume("ready"), warnings: string[] = []) {
  const { createAssessment } = await import("../src/core/assessment.js");
  return createAssessment(messages, state, warnings);
}

describe("createAssessment", () => {
  test("returns unknown for a sample that is too short", async () => {
    const result = await assess([message("m1"), message("m2")]);
    expect(result.status).toBe("unknown");
    expect(result.limitations).toContain("sample_too_short");
  });

  test("keeps low-risk sessions unknown when observability limits block a healthy label", async () => {
    const protectedMessages = Array.from({ length: 10 }, (_, index) =>
      message(`m${index + 1}`, { protected: index < 9 })
    );
    const unknownRoleMessages = Array.from({ length: 6 }, (_, index) =>
      message(`u${index + 1}`, { role: index < 3 ? "unknown" : "assistant" })
    );
    const partiallyObservableMessages = [
      message("o1", { role: "system" }),
      message("o2"),
      message("o3")
    ];

    const protectedResult = await assess(protectedMessages);
    const unknownRoleResult = await assess(unknownRoleMessages);
    const partiallyObservableResult = await assess(partiallyObservableMessages);

    expect(protectedResult.status).toBe("unknown");
    expect(protectedResult.coverage.protected_ratio).toBe(0.9);
    expect(unknownRoleResult.status).toBe("unknown");
    expect(unknownRoleResult.coverage.unknown_role_ratio).toBe(0.5);
    expect(partiallyObservableResult.status).toBe("unknown");
    expect(partiallyObservableResult.dimensions.observability.level).toBe("medium");
    expect(partiallyObservableResult.limitations).toContain("sample_too_short");
  });

  test("preserves established risk statuses when observability limitations remain", async () => {
    const highPressure = Array.from({ length: 10 }, (_, index) =>
      message(`p${index + 1}`, { protected: index < 9, tokens: 20_000 })
    );
    const protectedHighRot = Array.from({ length: 10 }, (_, index) =>
      message(`r${index + 1}`, {
        protected: index < 9,
        rot_score: index === 0 ? 0.7 : 0
      })
    );

    const degraded = await assess(highPressure);
    const attention = await assess(protectedHighRot);

    expect(degraded.status).toBe("degraded");
    expect(degraded.confidence).toBe("medium");
    expect(degraded.dimensions.context_pressure.level).toBe("high");
    expect(degraded.limitations).toContain("protected_coverage_too_high");
    expect(attention.status).toBe("attention");
    expect(attention.confidence).toBe("medium");
    expect(attention.limitations).toContain("protected_coverage_too_high");
  });

  test("reports attention when protected high-rot evidence needs review", async () => {
    const messages = Array.from({ length: 6 }, (_, index) => message(`m${index + 1}`));
    messages[0] = message("m1", { protected: true, rot_score: 0.7 });

    const result = await assess(messages);

    expect(result.status).toBe("attention");
    expect(result.dimensions.stale_context.evidence_count).toBeGreaterThan(0);
  });

  test("reports degraded for high token pressure, multiple high-confidence risks, or stale token ratio", async () => {
    const highContext = Array.from({ length: 6 }, (_, index) => message(`m${index + 1}`, { tokens: 30_000 }));
    const risky = Array.from({ length: 6 }, (_, index) => message(`r${index + 1}`));
    risky[0] = message("r1", { tokens: 300, evidence: [evidence("r1", "superseded")] });
    risky[1] = message("r2", { tokens: 300, evidence: [evidence("r2", "exact_duplicate")] });

    expect((await assess(highContext)).status).toBe("degraded");
    expect((await assess(risky)).status).toBe("degraded");
    expect((await assess(risky)).dimensions.stale_context.score).toBeGreaterThanOrEqual(0.2);
  });

  test("returns healthy only with sufficient low-risk positive evidence", async () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      message(`m${index + 1}`, { role: index % 2 === 0 ? "user" : "assistant" })
    );

    const result = await assess(messages);

    expect(result.status).toBe("healthy");
    expect(Object.values(result.dimensions).every((dimension) => dimension.level === "low")).toBe(true);
    expect(result.limitations).toEqual([]);
  });
});
