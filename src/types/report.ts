import type { Decision, NormalizedMessage, Reason, RotScores } from "./message.js";

export interface AnalyzedMessage {
  id: string;
  role: NormalizedMessage["role"];
  content: string;
  source: NormalizedMessage["source"];
  sourceLine: number;
  tokens: number;
  protected: boolean;
  rot_score: number;
  scores: RotScores;
  decision: Decision;
  reasons: Reason[];
  timestamp?: string;
  sessionId?: string;
}

export interface AnalysisSummary {
  total_messages: number;
  total_tokens: number;
  remove_candidates: number;
  estimated_saving_ratio: number;
  estimated_saving_tokens: number;
  protected_messages: number;
  compress_candidates: number;
  top_reasons: ReasonCount[];
  score_diagnostics: ScoreDiagnostics;
}

export interface ScoreRange {
  count: number;
  min: number;
  max: number;
  avg: number;
}

export interface ScoreDiagnostics {
  max_rot_score: number;
  p90_rot_score: number;
  near_remove_threshold_count: number;
  protected_high_rot_count: number;
  decision_score_ranges: Record<Decision, ScoreRange>;
}

export interface ReasonCount {
  reason: Reason;
  count: number;
}

export interface AnalysisReport {
  schema_version: "trimctx.report.v1";
  input: {
    file: string;
    source: NormalizedMessage["source"];
  };
  summary: AnalysisSummary;
  messages: AnalyzedMessage[];
  remove_candidates: AnalyzedMessage[];
  warnings: string[];
}
