import { createAnalysisWarnings } from "./diagnostics.js";
import { extractResumeState } from "./resume/extractor.js";
import type { AnalysisReport, AnalyzedMessage, TokenizationSummary } from "../types/report.js";
import type { NormalizedMessage, TokenBreakdown } from "../types/message.js";

type ReportForResume = Omit<AnalysisReport, "resume">;

export function createReport(messages: NormalizedMessage[], file: string): AnalysisReport {
  const analyzedMessages = messages.map(toAnalyzedMessage);
  // Report candidates are derived from analyzed decisions, matching the compressor's source of truth.
  const removeCandidates = analyzedMessages.filter((message) => message.decision === "remove_candidate");
  const totalTokens = analyzedMessages.reduce((sum, message) => sum + message.tokens, 0);
  const savingTokens = removeCandidates.reduce((sum, message) => sum + message.tokens, 0);
  const warnings = detectWarnings(messages);
  const tokenization = createTokenizationSummary(analyzedMessages);
  const reportWithoutResume: ReportForResume = {
    schema_version: "trimctx.report.v1" as const,
    input: {
      file,
      source: messages[0]?.source ?? "openai-jsonl"
    },
    summary: {
      total_messages: analyzedMessages.length,
      total_tokens: totalTokens,
      remove_candidates: removeCandidates.length,
      estimated_saving_ratio: totalTokens === 0 ? 0 : Number((savingTokens / totalTokens).toFixed(4)),
      estimated_saving_tokens: savingTokens,
      protected_messages: analyzedMessages.filter((message) => message.protected).length,
      compress_candidates: analyzedMessages.filter((message) => message.decision === "compress_candidate").length,
      token_estimation: {
        estimator: tokenization.tokenizer,
        estimator_version: tokenization.tokenizer === "tiktoken" ? "tiktoken-v1" : "approx-v1",
        estimated: tokenization.tokenizer !== "tiktoken",
        confidence: tokenization.confidence,
        note: tokenization.tokenizer === "tiktoken"
          ? "Model-specific tokenizer count."
          : "Zero-dependency local heuristic estimate; not a model-specific tokenizer count."
      },
      token_breakdown: sumTokenBreakdown(analyzedMessages),
      context_pressure: createContextPressure(analyzedMessages, removeCandidates, totalTokens, savingTokens),
      top_reasons: countTopReasons(analyzedMessages),
      score_diagnostics: createScoreDiagnostics(analyzedMessages)
    },
    tokenization,
    messages: analyzedMessages,
    remove_candidates: removeCandidates,
    warnings: [...warnings, ...createAnalysisWarnings(messages)]
  };
  return {
    ...reportWithoutResume,
    resume: extractResumeState(reportWithoutResume)
  };
}

function createTokenizationSummary(messages: AnalyzedMessage[]): TokenizationSummary {
  const firstMetadata = messages.find((message) => message.token_metadata)?.token_metadata;
  const estimator = firstMetadata?.estimator === "tiktoken" ? "tiktoken" : "local_heuristic";
  return {
    tokenizer: estimator,
    confidence: firstMetadata?.confidence ?? "medium"
  };
}

function emptyTokenBreakdown(): TokenBreakdown {
  return {
    cjk_chars: 0,
    ascii_tokens: 0,
    latin_words: 0,
    numbers: 0,
    symbols: 0,
    whitespace_runs: 0,
    code_like_segments: 0,
    path_like_segments: 0,
    json_like_segments: 0,
    line_count: 0,
    char_count: 0
  };
}

function sumTokenBreakdown(messages: AnalyzedMessage[]): TokenBreakdown {
  return messages.reduce((sum, message) => {
    const breakdown = message.token_metadata?.breakdown;
    if (!breakdown) return sum;
    return {
      cjk_chars: sum.cjk_chars + breakdown.cjk_chars,
      ascii_tokens: sum.ascii_tokens + breakdown.ascii_tokens,
      latin_words: sum.latin_words + breakdown.latin_words,
      numbers: sum.numbers + breakdown.numbers,
      symbols: sum.symbols + breakdown.symbols,
      whitespace_runs: sum.whitespace_runs + breakdown.whitespace_runs,
      code_like_segments: sum.code_like_segments + breakdown.code_like_segments,
      path_like_segments: sum.path_like_segments + breakdown.path_like_segments,
      json_like_segments: sum.json_like_segments + breakdown.json_like_segments,
      line_count: sum.line_count + breakdown.line_count,
      char_count: sum.char_count + breakdown.char_count
    };
  }, emptyTokenBreakdown());
}

function createContextPressure(
  messages: AnalyzedMessage[],
  removeCandidates: AnalyzedMessage[],
  totalTokens: number,
  savingTokens: number
): AnalysisReport["summary"]["context_pressure"] {
  const protectedTokens = messages
    .filter((message) => message.protected)
    .reduce((sum, message) => sum + message.tokens, 0);
  return {
    estimated_total_tokens: totalTokens,
    estimated_removable_tokens: savingTokens,
    estimated_protected_tokens: protectedTokens,
    remove_candidate_ratio: ratio(savingTokens, totalTokens),
    protected_token_ratio: ratio(protectedTokens, totalTokens),
    pressure_level: pressureLevel(totalTokens, removeCandidates.length)
  };
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function pressureLevel(totalTokens: number, removeCandidateCount: number): AnalysisReport["summary"]["context_pressure"]["pressure_level"] {
  if (totalTokens >= 150_000 || removeCandidateCount >= 20) return "high";
  if (totalTokens >= 50_000 || removeCandidateCount > 0) return "medium";
  return "low";
}

function createScoreDiagnostics(messages: AnalyzedMessage[]): AnalysisReport["summary"]["score_diagnostics"] {
  const rotScores = messages.map((message) => message.rot_score).sort((left, right) => left - right);

  // Diagnostics expose threshold pressure without changing the conservative default thresholds.
  return {
    max_rot_score: roundScore(rotScores.at(-1) ?? 0),
    p90_rot_score: percentile(rotScores, 0.9),
    near_remove_threshold_count: messages.filter((message) => message.rot_score >= 0.7 && message.rot_score < 0.8).length,
    protected_high_rot_count: messages.filter((message) => message.protected && message.rot_score >= 0.6).length,
    decision_score_ranges: {
      keep: scoreRange(messages.filter((message) => message.decision === "keep")),
      keep_protected: scoreRange(messages.filter((message) => message.decision === "keep_protected")),
      compress_candidate: scoreRange(messages.filter((message) => message.decision === "compress_candidate")),
      remove_candidate: scoreRange(messages.filter((message) => message.decision === "remove_candidate"))
    }
  };
}

function scoreRange(messages: AnalyzedMessage[]): AnalysisReport["summary"]["score_diagnostics"]["decision_score_ranges"]["keep"] {
  if (messages.length === 0) return { count: 0, min: 0, max: 0, avg: 0 };

  const scores = messages.map((message) => message.rot_score);
  const sum = scores.reduce((total, score) => total + score, 0);
  return {
    count: messages.length,
    min: roundScore(Math.min(...scores)),
    max: roundScore(Math.max(...scores)),
    avg: roundScore(sum / messages.length)
  };
}

function percentile(sortedScores: number[], ratio: number): number {
  if (sortedScores.length === 0) return 0;
  const index = Math.ceil(sortedScores.length * ratio) - 1;
  return roundScore(sortedScores[Math.max(0, Math.min(index, sortedScores.length - 1))]);
}

function roundScore(score: number): number {
  return Number(score.toFixed(4));
}

function detectWarnings(messages: NormalizedMessage[]): string[] {
  const warnings: string[] = [];
  const compactSubtypes = messages.flatMap((m) => {
    const raw = m.raw as Record<string, unknown> | undefined;
    if (!raw || raw.type !== "system") return [];
    return raw.subtype === "away_summary" || raw.subtype === "compact_boundary" ? [String(raw.subtype)] : [];
  });

  if (compactSubtypes.length > 0) {
    const uniqueSubtypes = [...new Set(compactSubtypes)].sort();
    warnings.push(
      `session_compacted: ${compactSubtypes.length} compact event(s) detected (${uniqueSubtypes.join(", ")}) — conversation was previously compressed`
    );
  }
  return warnings;
}

function countTopReasons(messages: AnalyzedMessage[]): AnalysisReport["summary"]["top_reasons"] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const reason of message.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([leftReason, leftCount], [rightReason, rightCount]) => {
      if (rightCount !== leftCount) return rightCount - leftCount;
      return leftReason.localeCompare(rightReason);
    })
    .slice(0, 5)
    .map(([reason, count]) => ({
      reason: reason as AnalysisReport["summary"]["top_reasons"][number]["reason"],
      count
    }));
}

function toAnalyzedMessage(message: NormalizedMessage): AnalyzedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    source: message.source,
    sourceLine: message.sourceLine,
    tokens: message.tokens ?? 0,
    token_metadata: message.token_metadata,
    protected: Boolean(message.protected),
    rot_score: message.rot_score ?? message.scores?.rot_score ?? 0,
    scores:
      message.scores ?? {
        superseded_score: 0,
        low_reference_score: 0,
        age_score: 0,
        redundancy_score: 0,
        orphan_tool_score: 0,
        low_value_score: 0,
        rot_score: 0
      },
    decision: message.decision ?? "keep",
    reasons: message.reasons ?? [],
    timestamp: message.timestamp,
    sessionId: message.sessionId
  };
}
