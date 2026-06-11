import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "../src/adapters/codex-jsonl.js";
import { analyzeMessages } from "../src/core/analyzer.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "./fixtures/codex-realistic.jsonl");

describe("parseCodexJsonl", () => {
  it("parses a realistic Codex JSONL with all response_item subtypes", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);

    // Filter out reasoning (skipped), count the rest:
    // - session_meta.base_instructions → system
    // - developer message → system
    // - user message → user
    // - assistant message → assistant
    // - function_call → assistant (tool_use)
    // - function_call_output → tool (tool_result)
    // - reasoning → skipped
    // - custom_tool_call → assistant (tool_use)
    // - custom_tool_call_output → tool (tool_result)
    // - assistant message (final) → assistant
    expect(messages).toHaveLength(9);

    // Check roles in order
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual([
      "system",   // base_instructions
      "system",   // developer
      "user",     // user
      "assistant", // assistant message
      "assistant", // function_call
      "tool",     // function_call_output
      "assistant", // custom_tool_call
      "tool",     // custom_tool_call_output
      "assistant", // assistant message
    ]);
  });

  it("maps session_meta base_instructions to protected system context", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const analyzed = analyzeMessages(messages, { recentWindow: 0 });
    const baseInstructions = analyzed[0];

    expect(baseInstructions.role).toBe("system");
    expect(baseInstructions.content).toBe("You are a helpful assistant.");
    expect(baseInstructions.sessionId).toBe("test-session-001");
    expect(baseInstructions.protected).toBe(true);
    expect(baseInstructions.reasons).toContain("system_or_developer_message");
  });

  it("maps developer role to system after base instructions", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const system = messages[1];

    expect(system.role).toBe("system");
    expect(system.content).toContain("coding assistant");
    expect(system.content).toContain("Be concise");
  });

  it("maps function_call to assistant with tool_use info", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const funcCall = messages.find(
      (m) => m.role === "assistant" && m.tool?.isToolUse && m.tool?.toolName === "shell_command",
    );

    expect(funcCall).toBeDefined();
    expect(funcCall!.content).toContain("python3 hello.py");
    expect(funcCall!.content).toContain("[tool_use shell_command call-001]");
    expect(funcCall!.tool?.isToolUse).toBe(true);
    expect(funcCall!.tool?.toolName).toBe("shell_command");
    expect(funcCall!.tool?.toolUseId).toBe("call-001");
  });

  it("maps function_call_output to tool with tool_result info", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const funcResult = messages.find(
      (m) => m.role === "tool" && m.content.includes("call-001"),
    );

    expect(funcResult).toBeDefined();
    expect(funcResult!.content).toContain("Hello, World!");
    expect(funcResult!.tool?.isToolResult).toBe(true);
    expect(funcResult!.tool?.toolResultFor).toBe("call-001");
  });

  it("maps custom_tool_call to assistant with tool_use info", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const customCall = messages.find(
      (m) => m.role === "assistant" && m.tool?.isToolUse && m.tool?.toolName === "apply_patch",
    );

    expect(customCall).toBeDefined();
    expect(customCall!.content).toContain("apply_patch");
    expect(customCall!.content).toContain("[tool_use apply_patch call-002]");
    expect(customCall!.tool?.isToolUse).toBe(true);
    expect(customCall!.tool?.toolName).toBe("apply_patch");
    expect(customCall!.tool?.toolUseId).toBe("call-002");
  });

  it("skips reasoning records (encrypted content)", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const hasReasoning = messages.some((m) => m.content.includes("encrypted_content"));

    expect(hasReasoning).toBe(false);
  });

  it("skips non-response_item event and turn metadata", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const hasMeta = messages.some(
      (m) => m.content.includes("codex-tui") || m.content.includes("task_started") || m.content.includes("Asia/Shanghai"),
    );

    expect(hasMeta).toBe(false);
  });

  it("sets source to codex-jsonl", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);

    for (const msg of messages) {
      expect(msg.source).toBe("codex-jsonl");
    }
  });

  it("preserves timestamps from outer record", async () => {
    const input = await readFile(fixturePath, "utf-8");
    const messages = parseCodexJsonl(input, fixturePath);
    const withTimestamp = messages.filter((m) => m.timestamp);

    expect(withTimestamp.length).toBeGreaterThan(0);
    expect(withTimestamp[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles empty input", () => {
    const messages = parseCodexJsonl("");
    expect(messages).toEqual([]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseCodexJsonl("{not json")).toThrow(/Invalid/i);
  });
});
