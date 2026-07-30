import type { MessageRole } from "./message.js";

export type EvidenceConfidence = "low" | "medium" | "high";

export type MessageKind =
  | "instruction"
  | "user_goal"
  | "decision"
  | "plan"
  | "progress"
  | "tool_use"
  | "tool_result"
  | "test_or_error"
  | "result"
  | "metadata"
  | "unknown";

export type SignalCode =
  | "low_value_metadata"
  | "exact_duplicate"
  | "similar_duplicate"
  | "superseded"
  | "orphan_tool_result"
  | "obsolete_tool_output"
  | "old_message"
  | "low_reference";

export interface SignalEvidence {
  code: SignalCode;
  confidence: EvidenceConfidence;
  message_id: string;
  source_line: number;
  role: MessageRole;
  related_message_id?: string;
  related_source_line?: number;
  similarity?: number;
  details: Record<string, string | number | boolean>;
}

export interface MessageAnalysisContext {
  kind: MessageKind;
  turn: number;
  segment: number;
  stable_identifiers: string[];
  evidence: SignalEvidence[];
}
