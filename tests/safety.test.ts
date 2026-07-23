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
  test("hard-protects every documented safety category", () => {
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

    // 硬保护：所有 README / usage 承诺“永不删除”的类别（不受 recent 影响）
    expect(protectedMessages[0].protected).toBe(true);
    expect(protectedMessages[0].reasons).toContain("system_or_developer_message");
    expect(protectedMessages[1].protected).toBe(true);
    expect(protectedMessages[1].reasons).toContain("contains_code_block");
    expect(protectedMessages[2].protected).toBe(true);
    expect(protectedMessages[2].reasons).toContain("contains_error_stack");
    expect(protectedMessages[3].protected).toBe(true);
    expect(protectedMessages[3].reasons).toContain("contains_file_path");
    expect(protectedMessages[4].protected).toBe(true);
    expect(protectedMessages[4].reasons).toContain("contains_shell_command");
    expect(protectedMessages[5].protected).toBe(true);
    expect(protectedMessages[5].reasons).toContain("contains_git_diff");
    expect(protectedMessages[6].protected).toBe(true);
    expect(protectedMessages[6].reasons).toContain("contains_user_decision");
    expect(protectedMessages[7].protected).toBe(true);
    expect(protectedMessages[7].reasons).toContain("contains_memory_instruction");
    expect(protectedMessages[8].protected).toBe(true);
    expect(protectedMessages[8].reasons).toContain("tool_result_referenced_later");

    // recent：最后 30 条消息被硬保护
    const last = protectedMessages[protectedMessages.length - 1];
    expect(last.protected).toBe(true);
    expect(last.reasons).toContain("recent_message");
  });

  test("hard-protects tool calls and results without treating their own ids as later references", () => {
    const messages: NormalizedMessage[] = [
      { ...message("m1", "assistant", "[tool_use Read tool-1] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m2", "tool", "[tool_result tool-1] old read output"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      message("m3", "tool", "tool output without normalized metadata"),
      message("m4", "assistant", "The read finished."),
      ...padding(35)
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[0].reasons).not.toContain("references_tool_result");
    expect(protectedMessages[0].reasons).toContain("contains_tool_interaction");
    expect(protectedMessages[0].protected).toBe(true);
    expect(protectedMessages[1].reasons).not.toContain("tool_result_referenced_later");
    expect(protectedMessages[1].reasons).toContain("contains_tool_interaction");
    expect(protectedMessages[1].protected).toBe(true);
    expect(protectedMessages[2].reasons).toContain("contains_tool_interaction");
    expect(protectedMessages[2].protected).toBe(true);
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
    expect(protectedMessages[1].protected).toBe(true);
  });

  test("protects away_summary messages", () => {
    const messages: NormalizedMessage[] = [
      {
        ...message("m1", "system", "compacted context"),
        source: "claude-code-jsonl",
        raw: { type: "system", subtype: "away_summary", message: { role: "system", content: "compacted context" } }
      },
      ...padding(35)
    ];

    const protectedMessages = applySafetyRules(messages);

    expect(protectedMessages[0].protected).toBe(true);
    expect(protectedMessages[0].reasons).toContain("system_or_developer_message");
  });

  test("only recognizes references after a tool result and before a real compact boundary", () => {
    const messages: NormalizedMessage[] = [
      message("m1", "assistant", "tool-1 was mentioned before its result."),
      { ...message("m2", "assistant", "[tool_use Read tool-1]"), tool: { isToolUse: true, toolUseId: "tool-1", toolName: "Read" } },
      { ...message("m3", "tool", "result one"), tool: { isToolResult: true, toolResultFor: "tool-1" } },
      { ...message("m4", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      message("m5", "assistant", "tool-1 was only mentioned after compaction."),
      { ...message("m6", "assistant", "[tool_use Read tool-2]"), tool: { isToolUse: true, toolUseId: "tool-2", toolName: "Read" } },
      { ...message("m7", "tool", "result two"), tool: { isToolResult: true, toolResultFor: "tool-2" } },
      message("m8", "assistant", "tool-2 supports the decision.")
    ];
    const protectedMessages = applySafetyRules(messages, { recentWindow: 0 });

    expect(protectedMessages[2]?.reasons).not.toContain("tool_result_referenced_later");
    expect(protectedMessages[6]?.reasons).toContain("tool_result_referenced_later");
  });

  test("uses source-scoped compact markers as hard protection", () => {
    const messages: NormalizedMessage[] = [
      {
        ...message("m1", "assistant", "Claude away summary"),
        source: "claude-code-jsonl",
        raw: { type: "system", subtype: "away_summary" }
      },
      {
        ...message("m2", "assistant", "Claude compact boundary"),
        source: "claude-code-jsonl",
        raw: { type: "system", subtype: "compact_boundary" }
      },
      {
        ...message("m3", "unknown", "Codex compacted"),
        source: "codex-jsonl",
        raw: { type: "compacted" }
      }
    ];

    const protectedMessages = applySafetyRules(messages, { recentWindow: 0 });

    expect(protectedMessages.every((entry) => entry.protected)).toBe(true);
    expect(protectedMessages.every((entry) => entry.reasons?.includes("system_or_developer_message"))).toBe(true);
  });

  test("does not protect OpenAI records that only resemble compact markers", () => {
    const messages: NormalizedMessage[] = [
      {
        ...message("m1", "assistant", "ordinary text"),
        source: "openai-jsonl",
        raw: { type: "system", subtype: "away_summary" }
      }
    ];

    const [result] = applySafetyRules(messages, { recentWindow: 0 });

    expect(result?.protected).toBe(false);
    expect(result?.reasons).not.toContain("system_or_developer_message");
  });
});
