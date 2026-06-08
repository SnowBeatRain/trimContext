export type MessageRole =
  | "system"
  | "developer"
  | "user"
  | "assistant"
  | "tool"
  | "unknown";

export type MessageSource = "claude-code-jsonl" | "openai-jsonl";

export type Decision =
  | "keep"
  | "keep_protected"
  | "compress_candidate"
  | "remove_candidate";

export type Reason =
  | "system_or_developer_message"
  | "recent_message"
  | "contains_code_block"
  | "contains_error_stack"
  | "contains_file_path"
  | "contains_shell_command"
  | "contains_git_diff"
  | "contains_test_failure"
  | "contains_memory_instruction"
  | "contains_user_decision"
  | "contains_architecture_or_api_decision"
  | "tool_result_referenced_later"
  | "references_tool_result"
  | "superseded_by_later_instruction"
  | "low_reference_in_later_context"
  | "old_message"
  | "duplicate_nearby_message"
  | "orphan_tool_result"
  | "large_low_value_tool_output"
  | "low_value_metadata";

export interface MessageToolInfo {
  toolUseId?: string;
  toolResultFor?: string;
  toolName?: string;
  isToolUse?: boolean;
  isToolResult?: boolean;
}

export interface RotScores {
  superseded_score: number;
  low_reference_score: number;
  age_score: number;
  redundancy_score: number;
  orphan_tool_score: number;
  low_value_score: number;
  rot_score: number;
}

export interface NormalizedMessage {
  id: string;
  role: MessageRole;
  content: string;
  source: MessageSource;
  sourceLine: number;
  rawLine: string;
  raw: unknown;
  timestamp?: string;
  sessionId?: string;
  parentId?: string;
  tool?: MessageToolInfo;
  tokens?: number;
  protected?: boolean;
  scores?: RotScores;
  rot_score?: number;
  decision?: Decision;
  reasons?: Reason[];
}
