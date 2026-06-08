import { describe, expect, test } from "vitest";
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
});
