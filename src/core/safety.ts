import type { NormalizedMessage, Reason } from "../types/message.js";

export function applySafetyRules(messages: NormalizedMessage[]): NormalizedMessage[] {
  const recentStart = findRecentWindowStart(messages, 6);
  const referencedToolResults = findReferencedToolResults(messages);

  return messages.map((message, index) => {
    const reasons = new Set<Reason>(message.reasons ?? []);
    const content = message.content;

    if (message.role === "system" || message.role === "developer") {
      reasons.add("system_or_developer_message");
    }
    if (index >= recentStart) {
      reasons.add("recent_message");
    }
    if (/```/.test(content)) {
      reasons.add("contains_code_block");
    }
    if (/(^|\n)\s*at\s+.+\(.+:\d+:\d+\)|Traceback \(most recent call last\)|\bError:\s+/i.test(content)) {
      reasons.add("contains_error_stack");
    }
    if (/(^|\s)([A-Za-z]:\\[^ \n\r\t]+|~?\/?[\w.-]+(?:\/[\w.-]+)+|[\w.-]+\.(ts|tsx|js|jsx|json|md|py|rs|go|java|vue|css|html))\b/.test(content)) {
      reasons.add("contains_file_path");
    }
    if (/(^|\n)\s*(npm|pnpm|yarn|node|git|npx|tsx|tsc|vitest|cargo|go|python|pip|claude|codex)\s+[\w:./\\-]/i.test(content)) {
      reasons.add("contains_shell_command");
    }
    if (/diff --git|^\+\+\+ |^--- /m.test(content)) {
      reasons.add("contains_git_diff");
    }
    if (/(\bFAIL\b|\bFAILED\b|AssertionError|expected .* received|Tests?\s+failed)/i.test(content)) {
      reasons.add("contains_test_failure");
    }
    if (/(记住|以后|从现在开始|不要忘记|remember|from now on|do not forget|don't forget)/i.test(content)) {
      reasons.add("contains_memory_instruction");
    }
    if (/(决定|决策|明确|采用|最终|decision|we decided|use .* as the)/i.test(content)) {
      reasons.add("contains_user_decision");
    }
    if (/(architecture|schema|配置|架构|接口|数据库|package\.json|tsconfig)/i.test(content)) {
      reasons.add("contains_architecture_or_api_decision");
    }
    if (message.tool?.isToolResult && message.tool.toolResultFor && referencedToolResults.has(message.tool.toolResultFor)) {
      reasons.add("tool_result_referenced_later");
    }
    if (!message.tool?.isToolResult && !message.tool?.isToolUse && referencesAnyToolResult(message.content, referencedToolResults)) {
      reasons.add("references_tool_result");
    }

    const next = { ...message, reasons: [...reasons] };
    next.protected = next.reasons.some((reason) =>
      [
        "system_or_developer_message",
        "recent_message",
        "contains_code_block",
        "contains_error_stack",
        "contains_file_path",
        "contains_shell_command",
        "contains_git_diff",
        "contains_test_failure",
        "contains_memory_instruction",
        "contains_user_decision",
        "contains_architecture_or_api_decision",
        "tool_result_referenced_later",
        "references_tool_result"
      ].includes(reason)
    );
    return next;
  });
}

function referencesAnyToolResult(content: string, ids: Set<string>): boolean {
  for (const id of ids) {
    if (new RegExp(`\\b${escapeRegExp(id)}\\b`).test(content)) {
      return true;
    }
  }
  return false;
}

function findRecentWindowStart(messages: NormalizedMessage[], userTurns: number): number {
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user" && !messages[index].tool?.isToolResult) {
      seen += 1;
      if (seen === userTurns) {
        return index;
      }
    }
  }
  return seen > 0 ? 0 : messages.length;
}

function findReferencedToolResults(messages: NormalizedMessage[]): Set<string> {
  const resultIds = new Set(
    messages
      .map((message) => message.tool?.toolResultFor)
      .filter((value): value is string => typeof value === "string")
  );
  const referenced = new Set<string>();

  for (const id of resultIds) {
    const escaped = escapeRegExp(id);
    const pattern = new RegExp(`\\b${escaped}\\b`);
    if (
      messages.some(
        (message) => !message.tool?.isToolResult && !message.tool?.isToolUse && pattern.test(message.content)
      )
    ) {
      referenced.add(id);
    }
  }

  return referenced;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
