export const REASON_LABELS: Record<string, string> = {
  low_value_metadata: "metadata noise",
  old_message: "old content",
  superseded_by_later_instruction: "superseded",
  low_reference_in_later_context: "low reference",
  duplicate_nearby_message: "duplicate",
  orphan_tool_result: "orphan tool result",
  large_low_value_tool_output: "large tool output",
  contains_file_path: "file path",
  contains_architecture_or_api_decision: "architecture",
  recent_message: "recent",
  contains_code_block: "code block",
  contains_test_failure: "test failure",
  system_or_developer_message: "system message",
  contains_user_decision: "user decision",
  contains_memory_instruction: "memory instruction",
  contains_error_stack: "error stack",
  contains_shell_command: "shell command",
  contains_git_diff: "git diff",
  tool_result_referenced_later: "referenced tool",
  references_tool_result: "references tool",
  contains_tool_interaction: "tool interaction"
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}
