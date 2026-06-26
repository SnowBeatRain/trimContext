import type { Decision, NormalizedMessage, Reason, RotScores, TokenBreakdown, TokenMetadata, TokenizerConfidence, TokenizerName } from "./message.js";
import type { ResumeState } from "./resume.js";

export interface AnalyzedMessage {
  id: string;
  role: NormalizedMessage["role"];
  content: string;
  source: NormalizedMessage["source"];
  sourceLine: number;
  tokens: number;
  token_metadata?: TokenMetadata;
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
  token_estimation: TokenEstimationSummary;
  token_breakdown: TokenBreakdown;
  context_pressure: ContextPressure;
  top_reasons: ReasonCount[];
  score_diagnostics: ScoreDiagnostics;
}

export interface TokenEstimationSummary {
  estimator: TokenizerName | "local_heuristic";
  estimator_version: "heuristic-v1" | "tiktoken-v1" | "approx-v1";
  estimated: boolean;
  confidence: TokenizerConfidence;
  note: string;
}

export interface TokenizationSummary {
  tokenizer: TokenizerName;
  confidence: TokenizerConfidence;
}

export interface ContextPressure {
  estimated_total_tokens: number;
  estimated_removable_tokens: number;
  estimated_protected_tokens: number;
  remove_candidate_ratio: number;
  protected_token_ratio: number;
  pressure_level: "low" | "medium" | "high";
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

export interface Phase0TrustStatus {
  status: "review_required" | "locked" | "failed";
  metrics: {
    critical_false_deletion: number | null;
    protected_recall: number | null;
    remove_candidate_precision: number | null;
  };
  gates: {
    critical_false_deletion: 0;
    protected_recall: 1;
    remove_candidate_precision: 0.7;
  };
  notes: string[];
}

export interface ParserDiagnostics {
  source: NormalizedMessage["source"];
  parsed_messages: number;
  source_lines: { min: number; max: number };
  role_counts: Partial<Record<NormalizedMessage["role"], number>>;
  empty_content_messages: number;
  missing_timestamp_messages: number;
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
    session_id?: string;
  };
  summary: AnalysisSummary;
  tokenization: TokenizationSummary;
  phase0_trust: Phase0TrustStatus;
  parser_diagnostics: ParserDiagnostics;
  resume: ResumeState;
  messages: AnalyzedMessage[];
  remove_candidates: AnalyzedMessage[];
  warnings: string[];
}
