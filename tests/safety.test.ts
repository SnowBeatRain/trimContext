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

function padding(count: number): NormalizedMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `pad${i}`;
    return message(id, i % 2 === 0 ? "user" : "assistant", `padding ${i}`);
  });
}

describe("safety rules", () => {
  test("marks reasons for all rules, hard-protects only system/memory/decision/recent", () => {
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
      ...padding(35)
    ];

    const protectedMessages = applySafetyRules(messages);

    // 硬保护：system、decision、memory（不受 recent 影响）
    expect(protectedMessages[0].protected).toBe(true);
    expect(protectedMessages[0].reasons).toContain("system_or_developer_message");
    expect(protectedMessages[6].protected).toBe(true);
    expect(protectedMessages[6].reasons).toContain("contains_user_decision");
    expect(protectedMessages[7].protected).toBe(true);
    expect(protectedMessages[7].reasons).toContain("contains_memory_instruction");

    // 重要性信号：有 reason 但不是硬保护（旧消息不在 recent 窗口内）
    expect(protectedMessages[1].reasons).toContain("contains_code_block");
    expect(protectedMessages[1].protected).toBe(false);
    expect(protectedMessages[2].reasons).toContain("contains_error_stack");
    expect(protectedMessages[2].protected).toBe(false);
    expect(protectedMessages[4].reasons).toContain("contains_shell_command");
    expect(protectedMessages[4].protected).toBe(false);

    // recent：最后 30 条消息被硬保护
    const last = protectedMessages[protectedMessages.length - 1];
    expect(last.protected).toBe(true);
    expect(last.reasons).toContain("recent_message");
  });

  test("does not protect old tool calls or results just because their own tool id appears", () => {
    const messages: NormalizedMessage[] = [
      { ...message("m1", "assistant", "[tool_use Read tool-1] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m2", "tool", "[tool_result tool-1] old read output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      message("m3", "assistant", "The read finished."),
      ...padding(35)
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[0].reasons).not.toContain("references_tool_result");
    expect(protectedMessages[0].protected).toBe(false);
    expect(protectedMessages[1].reasons).not.toContain("tool_result_referenced_later");
    expect(protectedMessages[1].protected).toBe(false);
  });

  test("marks tool_result_referenced_later as importance signal when later text references its id", () => {
    const messages: NormalizedMessage[] = [
      { ...message("m1", "assistant", "[tool_use Read tool-1] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m2", "tool", "[tool_result tool-1] important output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      message("m3", "assistant", "Decision came from tool-1."),
      ...padding(35)
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[1].reasons).toContain("tool_result_referenced_later");
    expect(protectedMessages[1].protected).toBe(false);
  });
});
