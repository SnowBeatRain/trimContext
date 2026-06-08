import { describe, expect, test } from "vitest";
import { applySafetyRules } from "../src/core/safety.js";
import type { NormalizedMessage } from "../src/types/message.js";

function message(id: string, role: NormalizedMessage["role"], content: string): NormalizedMessage {
  return {
    id,
    role,
    content,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    rawLine: "{}",
    raw: {}
  };
}

describe("safety rules", () => {
  test("protects privileged, recent, code, errors, paths, commands, diffs, decisions, memory, and referenced tool results", () => {
    const messages: NormalizedMessage[] = [
      message("m1", "system", "System rules"),
      message("m2", "assistant", "```ts\nconst x = 1\n```"),
      message("m3", "assistant", "Error: failed\n    at run (src/app.ts:10:2)"),
      message("m4", "user", "Open src/main.ts"),
      message("m5", "user", "npm test -- --run"),
      message("m6", "assistant", "diff --git a/a.ts b/a.ts"),
      message("m7", "user", "决定：API 使用 /v1/report"),
      message("m8", "user", "记住以后都使用 TypeScript"),
      { ...message("m9", "tool", "important output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      { ...message("m10", "assistant", "use tool-1 result"), tool: { isToolUse: false } },
      message("m11", "user", "recent 1"),
      message("m12", "assistant", "recent 1 answer"),
      message("m13", "user", "recent 2"),
      message("m14", "assistant", "recent 2 answer"),
      message("m15", "user", "recent 3"),
      message("m16", "assistant", "recent 3 answer"),
      message("m17", "user", "recent 4"),
      message("m18", "assistant", "recent 4 answer"),
      message("m19", "user", "recent 5"),
      message("m20", "assistant", "recent 5 answer"),
      message("m21", "user", "recent 6"),
      message("m22", "assistant", "recent 6 answer")
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages.every((item) => item.protected)).toBe(true);
    expect(protectedMessages[0].reasons).toContain("system_or_developer_message");
    expect(protectedMessages[1].reasons).toContain("contains_code_block");
    expect(protectedMessages[2].reasons).toContain("contains_error_stack");
    expect(protectedMessages[4].reasons).toContain("contains_shell_command");
    expect(protectedMessages[6].reasons).toContain("contains_user_decision");
    expect(protectedMessages[8].reasons).toContain("tool_result_referenced_later");
    expect(protectedMessages[10].reasons).toContain("recent_message");
  });

  test("does not protect old tool calls or results just because their own tool id appears", () => {
    const messages: NormalizedMessage[] = [
      { ...message("m1", "assistant", "[tool_use Read tool-1] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m2", "tool", "[tool_result tool-1] old read output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      message("m3", "assistant", "The read finished."),
      message("m4", "user", "recent 1"),
      message("m5", "assistant", "recent 1 answer"),
      message("m6", "user", "recent 2"),
      message("m7", "assistant", "recent 2 answer"),
      message("m8", "user", "recent 3"),
      message("m9", "assistant", "recent 3 answer"),
      message("m10", "user", "recent 4"),
      message("m11", "assistant", "recent 4 answer"),
      message("m12", "user", "recent 5"),
      message("m13", "assistant", "recent 5 answer"),
      message("m14", "user", "recent 6"),
      message("m15", "assistant", "recent 6 answer")
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[0].reasons).not.toContain("references_tool_result");
    expect(protectedMessages[0].protected).toBe(false);
    expect(protectedMessages[1].reasons).not.toContain("tool_result_referenced_later");
    expect(protectedMessages[1].protected).toBe(false);
  });

  test("protects a tool result when a later natural-language summary references its id", () => {
    const messages: NormalizedMessage[] = [
      { ...message("m1", "assistant", "[tool_use Read tool-1] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m2", "tool", "[tool_result tool-1] important output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      message("m3", "assistant", "Decision came from tool-1."),
      message("m4", "user", "recent 1"),
      message("m5", "assistant", "recent 1 answer"),
      message("m6", "user", "recent 2"),
      message("m7", "assistant", "recent 2 answer"),
      message("m8", "user", "recent 3"),
      message("m9", "assistant", "recent 3 answer"),
      message("m10", "user", "recent 4"),
      message("m11", "assistant", "recent 4 answer"),
      message("m12", "user", "recent 5"),
      message("m13", "assistant", "recent 5 answer"),
      message("m14", "user", "recent 6"),
      message("m15", "assistant", "recent 6 answer")
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[1].reasons).toContain("tool_result_referenced_later");
    expect(protectedMessages[1].protected).toBe(true);
  });
});
