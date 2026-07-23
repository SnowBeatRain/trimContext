import type { Decision, NormalizedMessage, Reason, RotScores, TokenBreakdown, TokenMetadata, TokenizerConfidence, TokenizerName } from "./message.js";
import type { ResumeState } from "./resume.js";
import type { EvidenceConfidence, MessageAnalysisContext, SignalCode } from "./signals.js";

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
  analysis: MessageAnalysisContext;
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

export type HealthStatus = "healthy" | "attention" | "degraded" | "unknown";

export interface HealthDimension {
  level: "low" | "medium" | "high" | "unknown";
  score: number;
  evidence_count: number;
  summary: string;
}

export interface Assessment {
  status: HealthStatus;
  confidence: EvidenceConfidence;
  summary: string;
  dimensions: {
    context_pressure: HealthDimension;
    stale_context: HealthDimension;
    repetition: HealthDimension;
    tool_noise: HealthDimension;
    continuation: HealthDimension;
    observability: HealthDimension;
  };
  coverage: {
    analyzable_messages: number;
    analyzable_ratio: number;
    protected_ratio: number;
    unknown_role_ratio: number;
  };
  limitations: string[];
}

export interface FindingEvidenceRef {
  message_id: string;
  source_line: number;
  role: NormalizedMessage["role"];
  code: string;
  confidence: EvidenceConfidence;
  related_message_id?: string;
}

export interface Finding {
  id: string;
  type: "superseded" | "duplicate" | "tool" | "metadata" | "limitation";
  severity: "info" | "warning" | "critical";
  confidence: EvidenceConfidence;
  code: string;
  title: string;
  explanation: string;
  summary: string;
  impact: {
    message_count: number;
    tokens: number;
    token_ratio: number;
  };
  suggested_action: "review_superseded_context" | "keep_canonical_message" | "review_tool_evidence" | "review_metadata" | "collect_more_evidence";
  tokens: number;
  evidence: FindingEvidenceRef[];
}

export interface ReviewQueueItem {
  message_id: string;
  source_line: number;
  role: NormalizedMessage["role"];
  decision: Decision;
  protected: boolean;
  tokens: number;
  risk: "low" | "medium" | "high";
  confidence: EvidenceConfidence;
  reasons: Reason[];
  evidence: FindingEvidenceRef[];
  summary: string;
  default_action: "remove_after_review" | "compress_after_review" | "keep_and_review";
}

export interface CandidateGroup {
  id: string;
  type: "superseded" | "duplicate" | "tool" | "metadata";
  code: SignalCode;
  related_message_id?: string;
  canonical_message_id: string;
  member_message_ids: string[];
  tokens: number;
  evidence: FindingEvidenceRef[];
}

export interface Recommendation {
  code: "write_report" | "clarify_continuation" | "new_chat" | "review_then_compress";
  priority: number;
  summary: string;
  command?: string;
}

export interface AnalysisMeta {
  analyzer_version: "evidence-v2";
  thresholds: {
    recent_window: number;
    remove: number;
    compress: number;
  };
  tokenizer: TokenizerName;
  confidence: TokenizerConfidence;
  detectors: string[];
  coverage: Assessment["coverage"];
  limitations: string[];
}

export interface AnalysisReport {
  schema_version: "trimctx.report.v2";
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
  assessment: Assessment;
  findings: Finding[];
  review_queue: { items: ReviewQueueItem[] };
  candidate_groups: CandidateGroup[];
  compress_candidates: AnalyzedMessage[];
  recommendations: Recommendation[];
  analysis_meta: AnalysisMeta;
  messages: AnalyzedMessage[];
  remove_candidates: AnalyzedMessage[];
  warnings: string[];
}
