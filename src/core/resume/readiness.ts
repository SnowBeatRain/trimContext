import type { ResumeReadiness, ResumeState } from "../../types/resume.js";

type ResumeSignals = Omit<ResumeState, "readiness">;

const READINESS_WEIGHTS = {
  current_goal: 20,
  decisions: 20,
  active_files: 15,
  failures: 15,
  test_signals: 15,
  next_steps: 15
} as const;

const MISSING_LABELS: Record<keyof typeof READINESS_WEIGHTS, string> = {
  current_goal: "current goal",
  decisions: "user decisions",
  active_files: "active files",
  failures: "failed attempts",
  test_signals: "test signals",
  next_steps: "next steps"
};

export function scoreResumeReadiness(state: ResumeSignals): ResumeReadiness {
  const signals = {
    current_goal: Boolean(state.currentGoal),
    decisions: state.decisions.length > 0,
    active_files: state.activeFiles.length > 0,
    failures: state.failures.length > 0,
    test_signals: state.testSignals.length > 0,
    next_steps: state.nextSteps.length > 0
  };

  const score = (Object.entries(signals) as Array<[keyof typeof signals, boolean]>).reduce(
    (total, [signal, present]) => total + (present ? READINESS_WEIGHTS[signal] : 0),
    0
  );
  const missing = (Object.entries(signals) as Array<[keyof typeof signals, boolean]>)
    .filter(([, present]) => !present)
    .map(([signal]) => MISSING_LABELS[signal]);

  return {
    score,
    level: score >= 80 ? "ready" : score >= 45 ? "partial" : "blocked",
    missing,
    signals
  };
}
