import type { ResumeReadiness, ResumeState } from "../../types/resume.js";

type ResumeSignals = Omit<ResumeState, "readiness">;

type RequiredSignal = "current_goal" | "decisions" | "active_files" | "test_signals" | "next_steps";

const READINESS_WEIGHTS: Record<RequiredSignal, number> = {
  current_goal: 30,
  decisions: 20,
  active_files: 10,
  test_signals: 15,
  next_steps: 25
};

const MISSING_LABELS: Record<RequiredSignal, string> = {
  current_goal: "current goal",
  decisions: "user decisions",
  active_files: "active files",
  test_signals: "test signals",
  next_steps: "next steps"
};

export function scoreResumeReadiness(state: ResumeSignals): ResumeReadiness {
  const signals: Record<RequiredSignal, boolean> = {
    current_goal: isTrustedEvidence(state.currentGoal),
    decisions: state.decisions.some(isTrustedEvidence),
    active_files: state.activeFiles.some(isTrustedEvidence),
    test_signals: state.testSignals.some(isTrustedEvidence),
    next_steps: state.nextSteps.some(isTrustedEvidence)
  };

  const score = (Object.entries(READINESS_WEIGHTS) as Array<[RequiredSignal, number]>).reduce(
    (total, [signal, weight]) => total + (signals[signal] ? weight : 0),
    0
  );
  const missing = (Object.keys(READINESS_WEIGHTS) as RequiredSignal[])
    .filter((signal) => !signals[signal])
    .map((signal) => MISSING_LABELS[signal]);

  return {
    score,
    level: signals.current_goal && signals.next_steps && score >= 75
      ? "ready"
      : score >= 40 ? "partial" : "blocked",
    missing,
    signals
  };
}

function isTrustedEvidence(
  evidence: { confidence: "low" | "medium" | "high" } | undefined
): boolean {
  return evidence !== undefined && evidence.confidence !== "low";
}
