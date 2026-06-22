import type { MessageRole } from "./message.js";

export interface ResumeEvidence {
  text: string;
  sourceLine: number;
  messageId: string;
  role: MessageRole;
}

export interface ResumeFileEvidence {
  path: string;
  sourceLine: number;
  messageId: string;
}

export interface ResumeReadiness {
  score: number;
  level: "blocked" | "partial" | "ready";
  missing: string[];
  signals: {
    current_goal: boolean;
    decisions: boolean;
    active_files: boolean;
    failures: boolean;
    test_signals: boolean;
    next_steps: boolean;
  };
}

export interface ResumeState {
  currentGoal?: ResumeEvidence;
  decisions: ResumeEvidence[];
  activeFiles: ResumeFileEvidence[];
  failures: ResumeEvidence[];
  testSignals: ResumeEvidence[];
  nextSteps: ResumeEvidence[];
  readiness: ResumeReadiness;
}
