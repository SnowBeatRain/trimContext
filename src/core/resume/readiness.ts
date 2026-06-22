import type { ResumeReadiness, ResumeState } from "../../types/resume.js";

type ResumeSignals = Omit<ResumeState, "readiness">;

type RequiredSignal = "current_goal" | "decisions" | "active_files" | "test_signals" | "next_steps";
type OptionalSignal = "failures";
type SignalName = RequiredSignal | OptionalSignal;

const READINESS_WEIGHTS: Record<RequiredSignal, number> = {
  current_goal: 20,
  decisions: 20,
  active_files: 15,
  test_signals: 15,
  next_steps: 15
};

const OPTIONAL_WEIGHTS: Record<OptionalSignal, number> = {
  failures: 15
};

const MISSING_LABELS: Record<RequiredSignal, string> = {
  current_goal: "current goal",
  decisions: "user decisions",
  active_files: "active files",
  test_signals: "test signals",
  next_steps: "next steps"
};

export function scoreResumeReadiness(state: ResumeSignals): ResumeReadiness {
  const signals: Record<SignalName, boolean> = {
    current_goal: Boolean(state.currentGoal),
    decisions: state.decisions.length > 0,
    active_files: state.activeFiles.length > 0,
    failures: state.failures.length > 0,
    test_signals: state.testSignals.length > 0,
    next_steps: state.nextSteps.length > 0
  };

  const requiredScore = (Object.entries(READINESS_WEIGHTS) as Array<[RequiredSignal, number]>).reduce(
    (total, [signal, weight]) => total + (signals[signal] ? weight : 0),
    0
  );
  const optionalScore = (Object.entries(OPTIONAL_WEIGHTS) as Array<[OptionalSignal, number]>).reduce(
    (total, [signal, weight]) => total + (signals[signal] ? weight : 0),
    0
  );
  const score = Math.min(100, requiredScore + optionalScore);
  const missing = (Object.keys(READINESS_WEIGHTS) as RequiredSignal[])
    .filter((signal) => !signals[signal])
    .map((signal) => MISSING_LABELS[signal]);

  return {
    score,
    level: score >= 80 ? "ready" : score >= 45 ? "partial" : "blocked",
    missing,
    signals
  };
}
