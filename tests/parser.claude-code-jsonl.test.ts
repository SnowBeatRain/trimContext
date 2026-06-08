import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parseClaudeCodeJsonl } from "../src/adapters/claude-code-jsonl.js";
import { parseJsonl } from "../src/core/analyzer.js";

describe("Claude Code JSONL parser", () => {
  test("normalizes text, metadata, tool use, and tool result events", () => {
    const input = [
      '{"type":"user","uuid":"u1","timestamp":"2026-06-05T00:00:00.000Z","sessionId":"s1","message":{"role":"user","content":"Inspect src/app.ts"}}',
      '{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"s1","message":{"role":"assistant","content":[{"type":"text","text":"Reading file"},{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"src/app.ts"}}]}}',
      '{"type":"user","uuid":"t1","parentUuid":"a1","sessionId":"s1","message":{"role":"tool","content":[{"type":"tool_result","tool_use_id":"tool-1","content":"const ok = true;"}]}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      id: "u1",
      role: "user",
      source: "claude-code-jsonl",
      sourceLine: 1,
      sessionId: "s1",
      timestamp: "2026-06-05T00:00:00.000Z",
      content: "Inspect src/app.ts"
    });
    expect(messages[1].content).toContain("Reading file");
    expect(messages[1].content).toContain("Read");
    expect(messages[1].tool?.toolUseId).toBe("tool-1");
    expect(messages[1].tool?.toolName).toBe("Read");
    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool?.toolResultFor).toBe("tool-1");
    expect(messages[2].rawLine).toContain('"tool_result"');
  });

  test("auto-detects real Claude Code files that start with metadata events", () => {
    const input = [
      '{"type":"mode","mode":"default","sessionId":"s1"}',
      '{"type":"permission-mode","permissionMode":"acceptEdits","sessionId":"s1"}',
      '{"type":"file-history-snapshot","messageId":"m1","snapshot":{"files":["src/app.ts"]},"isSnapshotUpdate":false}',
      '{"parentUuid":null,"type":"user","uuid":"u1","timestamp":"2026-06-05T00:00:00.000Z","sessionId":"s1","message":{"role":"user","content":"nihao"}}',
      '{"type":"attachment","uuid":"att1","sessionId":"s1","attachment":{"type":"skill_listing","content":"- skill: useful instructions"}}',
      '{"type":"system","subtype":"compact_boundary","uuid":"sys-meta","sessionId":"s1","messageCount":4}',
      '{"type":"last-prompt","lastPrompt":"nihao","leafUuid":"u1","sessionId":"s1"}'
    ].join("\n");

    const messages = parseJsonl(input, "real.jsonl");

    expect(messages).toHaveLength(7);
    expect(messages[0]).toMatchObject({
      id: "real.jsonl:1",
      role: "unknown",
      content: "[mode] default",
      source: "claude-code-jsonl"
    });
    expect(messages[2].content).toContain("file-history-snapshot");
    expect(messages[3]).toMatchObject({ id: "u1", role: "user", content: "nihao" });
    expect(messages[4].content).toContain("skill_listing");
    expect(messages[5].role).toBe("system");
    expect(messages[6].content).toContain("last-prompt");
  });

  test("treats isMeta user messages as system with [isMeta] prefix", () => {
    const input = [
      '{"type":"user","isMeta":true,"uuid":"meta1","sessionId":"s1","message":{"role":"user","content":"Skill instructions here"}}',
      '{"type":"user","uuid":"u1","sessionId":"s1","message":{"role":"user","content":"Real user message"}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("[isMeta]");
    expect(messages[0].content).toContain("Skill instructions here");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("Real user message");
  });

  test("deduplicates streaming fragments by message.id", () => {
    const input = [
      '{"type":"assistant","uuid":"a1","sessionId":"s1","message":{"id":"msg-1","role":"assistant","content":"Hello"}}',
      '{"type":"assistant","uuid":"a1","sessionId":"s1","message":{"id":"msg-1","role":"assistant","content":"Hello","usage":{"input_tokens":100,"output_tokens":50}}}',
      '{"type":"user","uuid":"u1","sessionId":"s1","message":{"role":"user","content":"next"}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("user");
  });

  test("handles tool_result with list content", () => {
    const input = [
      '{"type":"user","uuid":"t1","sessionId":"s1","message":{"role":"tool","content":[{"type":"tool_result","tool_use_id":"tool-1","content":[{"type":"text","text":"file line 1"},{"type":"text","text":"file line 2"}]}]}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("tool");
    expect(messages[0].content).toContain("file line 1");
    expect(messages[0].content).toContain("file line 2");
    expect(messages[0].tool?.toolResultFor).toBe("tool-1");
  });

  test("handles thinking blocks in assistant messages", () => {
    const input = [
      '{"type":"assistant","uuid":"a1","sessionId":"s1","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me analyze this..."},{"type":"text","text":"Here is my answer"}]}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("Let me analyze this...");
    expect(messages[0].content).toContain("Here is my answer");
  });

  test("handles mixed text and tool_result in user messages", () => {
    const input = [
      '{"type":"user","uuid":"u1","sessionId":"s1","message":{"role":"tool","content":[{"type":"text","text":"I saw the result."},{"type":"tool_result","tool_use_id":"tool-1","content":"file contents here"}]}}'
    ].join("\n");

    const messages = parseClaudeCodeJsonl(input, "session.jsonl");

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("I saw the result.");
    expect(messages[0].content).toContain("file contents here");
    expect(messages[0].tool?.toolResultFor).toBe("tool-1");
  });

  test("covers sanitized Claude Code edge-case fixture", () => {
    const input = readFileSync("tests/fixtures/claude-code-edge-cases.jsonl", "utf8");

    const messages = parseJsonl(input, "tests/fixtures/claude-code-edge-cases.jsonl");

    expect(messages.some((message) => message.role === "user" && message.content.includes("Injected skill"))).toBe(false);
    const meta = messages.find((message) => message.id === "meta-1");
    expect(meta).toMatchObject({
      role: "system",
      content: expect.stringContaining("[isMeta]")
    });

    const streamMessages = messages.filter((message) => {
      const raw = message.raw as { message?: { id?: string } };
      return raw.message?.id === "assistant-stream-1";
    });
    expect(streamMessages).toHaveLength(1);
    expect(streamMessages[0].content).toBe("Final answer");

    expect(messages.find((message) => message.id === "tool-result-string")?.content).toContain("string result content");
    expect(messages.find((message) => message.id === "tool-result-list")?.content).toContain("list result line 2");
    expect(messages.find((message) => message.id === "tool-result-list")?.tool?.toolResultFor).toBe("tool-2");

    const awaySummary = messages.find((message) => message.id === "away-1");
    expect(awaySummary?.role).toBe("system");
    expect((awaySummary?.raw as { subtype?: string }).subtype).toBe("away_summary");
  });
});
