import type { NormalizedMessage, RotScores } from "../types/message.js";
import type { SignalCode } from "../types/signals.js";

export const DECISIVE_STRENGTH: Record<Exclude<SignalCode, "old_message" | "low_reference">, number> = {
  low_value_metadata: 0.9,
  exact_duplicate: 0.82,
  superseded: 0.78,
  obsolete_tool_output: 0.72,
  similar_duplicate: 0.65,
  orphan_tool_result: 0.65
};

const IMPORTANCE_DISCOUNTS: Record<string, number> = {
  contains_code_block: 0.15,
  contains_error_stack: 0.15,
  contains_git_diff: 0.15,
  contains_test_failure: 0.15,
  contains_shell_command: 0.1,
  contains_architecture_or_api_decision: 0.1,
  tool_result_referenced_later: 0.1,
  contains_file_path: 0.05,
  references_tool_result: 0.05
};

export function computeRotScores(message: NormalizedMessage): RotScores {
  const evidence = message.analysis?.evidence ?? [];
  const signalScore = (codes: SignalCode[]) => Math.max(0, ...evidence.filter((entry) => codes.includes(entry.code)).map(strength));
  const superseded_score = signalScore(["superseded"]);
  const low_reference_score = signalScore(["low_reference"]);
  const age_score = signalScore(["old_message"]);
  const redundancy_score = signalScore(["exact_duplicate", "similar_duplicate"]);
  const orphan_tool_score = signalScore(["orphan_tool_result", "obsolete_tool_output"]);
  const low_value_score = signalScore(["low_value_metadata"]);
  const decisive = Math.max(superseded_score, redundancy_score, orphan_tool_score, low_value_score);
  const supportBonus = Math.min(0.15,
    (evidence.some((entry) => entry.code === "old_message") ? 0.08 : 0) +
    (evidence.some((entry) => entry.code === "low_reference") ? 0.07 : 0) +
    ((message.tokens ?? 0) > 200 ? 0.03 : 0)
  );
  const rot_score = clamp(decisive === 0 ? 0 : decisive + supportBonus - computeImportanceDiscount(message));
  return { superseded_score, low_reference_score, age_score, redundancy_score, orphan_tool_score, low_value_score, rot_score };
}

export function isHighDecisive(message: NormalizedMessage): boolean {
  return (message.analysis?.evidence ?? []).some((entry) => entry.confidence === "high" && entry.code in DECISIVE_STRENGTH);
}

export function hasDecisiveEvidence(message: NormalizedMessage): boolean {
  return (message.analysis?.evidence ?? []).some((entry) => entry.confidence !== "low" && entry.code in DECISIVE_STRENGTH);
}

function strength(evidence: { code: SignalCode; details: Record<string, string | number | boolean> }): number {
  const declared = evidence.details.strength;
  if (typeof declared === "number" && Number.isFinite(declared) && declared >= 0 && declared <= 1) return declared;
  if (evidence.code === "old_message") return 0.08;
  if (evidence.code === "low_reference") return 0.07;
  return DECISIVE_STRENGTH[evidence.code];
}

function computeImportanceDiscount(message: NormalizedMessage): number {
  return (message.reasons ?? []).reduce((total, reason) => total + (IMPORTANCE_DISCOUNTS[reason] ?? 0), 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
