import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canRemoveFromCompressedCopy, compressFile } from "../src/core/compressor.js";
import type { NormalizedMessage } from "../src/types/message.js";

function countOpenAiMessages(jsonl: string): number {
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .reduce((count, line) => {
      const raw = JSON.parse(line) as { messages?: unknown[] };
      return count + (Array.isArray(raw.messages) ? raw.messages.length : 1);
    }, 0);
}

describe("compressor", () => {
  test("requires a non-protected remove candidate with a reason and high decisive evidence", () => {
    const candidate: NormalizedMessage = {
      id: "m1", role: "assistant", content: "unsafe manual candidate", source: "openai-jsonl", sourceLine: 1, rawLine: "{}", raw: {},
      protected: false, decision: "remove_candidate", reasons: ["duplicate_message"],
      analysis: { kind: "result", turn: 0, segment: 0, stable_identifiers: [], evidence: [] }
    };

    expect(canRemoveFromCompressedCopy(candidate)).toBe(false);
    expect(canRemoveFromCompressedCopy({
      ...candidate,
      analysis: { ...candidate.analysis!, evidence: [{ code: "exact_duplicate", confidence: "high", message_id: "m1", source_line: 1, role: "assistant", details: {} }] }
    })).toBe(true);
    expect(canRemoveFromCompressedCopy({
      ...candidate,
      protected: true,
      analysis: { ...candidate.analysis!, evidence: [{ code: "exact_duplicate", confidence: "high", message_id: "m1", source_line: 1, role: "assistant", details: {} }] }
    })).toBe(false);
    expect(canRemoveFromCompressedCopy({
      ...candidate,
      source: "codex-jsonl",
      raw: { type: "compacted" },
      analysis: { ...candidate.analysis!, evidence: [{ code: "exact_duplicate", confidence: "high", message_id: "m1", source_line: 1, role: "assistant", details: {} }] }
    })).toBe(false);
  });
  test("writes a new file, preserves original input, removes only unprotected remove candidates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "session.jsonl");
    const output = join(dir, "session.trimmed.jsonl");
    const padding = Array.from({ length: 35 }, (_, i) =>
      `{"type":"${i % 2 === 0 ? "user" : "assistant"}","uuid":"pad-${i}","message":{"role":"${i % 2 === 0 ? "user" : "assistant"}","content":"padding ${i}"}}`
    );
    const original = [
      '{"type":"assistant","uuid":"old-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
      '{"type":"assistant","uuid":"old-2","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
      '{"type":"user","uuid":"new-1","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}',
      '{"type":"assistant","uuid":"new-2","message":{"role":"assistant","content":"Okay use new billing endpoint"}}',
      '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
      ...padding
    ].join("\n");
    await writeFile(input, original, "utf8");

    const result = await compressFile(input, output);
    const after = await readFile(input, "utf8");
    const compressed = await readFile(output, "utf8");

    const originalLineCount = original.split("\n").length;
    const compressedLineCount = compressed.split("\n").filter((line) => line.length > 0).length;

    expect(after).toBe(original);
    expect(compressed).not.toContain("old-1");
    expect(compressed).toContain("sys-1");
    expect(compressed).toContain("pad-34");
    expect(result.removedMessages).toBeGreaterThanOrEqual(1);
    expect(result.removedMessages).toBe(result.report.remove_candidates.length);
    expect(result.report.summary.remove_candidates).toBe(result.report.remove_candidates.length);
    expect(originalLineCount - compressedLineCount).toBe(result.removedMessages);
    expect(result.report.remove_candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true);
  });

  test("keeps paired tool calls and results even when an old call has high duplicate evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "paired-tools.jsonl");
    const output = join(dir, "paired-tools.trimmed.jsonl");
    const padding = Array.from({ length: 35 }, (_, i) =>
      JSON.stringify({
        type: i % 2 === 0 ? "user" : "assistant",
        uuid: `pad-${i}`,
        message: { role: i % 2 === 0 ? "user" : "assistant", content: `padding ${i}` }
      })
    );
    const original = [
      JSON.stringify({
        type: "assistant",
        uuid: "call-record-1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call-1", name: "Search", input: { query: "API_KEY" } }]
        }
      }),
      JSON.stringify({
        type: "user",
        uuid: "output-record-1",
        message: {
          role: "tool",
          content: [{ type: "tool_result", tool_use_id: "call-1", content: "old search output with one match" }]
        }
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "call-record-2",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "call-2", name: "Search", input: { query: "API_KEY" } }]
        }
      }),
      JSON.stringify({
        type: "user",
        uuid: "output-record-2",
        message: {
          role: "tool",
          content: [{ type: "tool_result", tool_use_id: "call-2", content: "fresh search output with two matches" }]
        }
      }),
      ...padding
    ].join("\n");
    await writeFile(input, original, "utf8");

    const result = await compressFile(input, output);
    const compressed = await readFile(output, "utf8");
    const oldUse = result.report.messages.find((entry) => entry.id === "call-record-1");
    const oldResult = result.report.messages.find((entry) => entry.id === "output-record-1");

    expect(compressed).toContain('"uuid":"call-record-1"');
    expect(compressed).toContain('"uuid":"output-record-1"');
    expect(compressed).toContain('"uuid":"call-record-2"');
    expect(compressed).toContain('"uuid":"output-record-2"');
    expect(oldUse?.analysis?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "exact_duplicate" })
    ]));
    expect(oldUse?.rot_score).toBeGreaterThan(0);
    expect(oldUse).toMatchObject({ protected: true, decision: "keep_protected" });
    expect(oldResult?.analysis?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "obsolete_tool_output" })
    ]));
    expect(oldResult?.rot_score).toBeGreaterThan(0);
    expect(oldResult).toMatchObject({ protected: true, decision: "keep_protected" });
  });

  test("preserves Codex non-message records when compressing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "codex.jsonl");
    const output = join(dir, "codex.trimmed.jsonl");
    const original = [
      JSON.stringify({
        timestamp: "2026-06-09T05:50:37.175Z",
        type: "session_meta",
        payload: {
          id: "test-session-001",
          base_instructions: { text: "You are a helpful assistant." }
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:38.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-001", cwd: "/home/user/project" }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:39.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:51:20.000Z",
        type: "response_item",
        payload: { type: "reasoning", encrypted_content: "abc123encrypted" }
      })
    ].join("\n");
    await writeFile(input, original, "utf8");

    await compressFile(input, output);
    const compressed = await readFile(output, "utf8");

    expect(compressed).toContain('"type":"session_meta"');
    expect(compressed).toContain('"type":"turn_context"');
    expect(compressed).toContain('"type":"reasoning"');
    expect(compressed.split("\n")).toHaveLength(4);
  });

  test("preserves skipped Codex records even while removing stale messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "codex-skipped-with-removal.jsonl");
    const output = join(dir, "codex-skipped-with-removal.trimmed.jsonl");
    const padding = Array.from({ length: 35 }, (_, i) =>
      JSON.stringify({
        timestamp: `2026-06-09T05:52:${String(i).padStart(2, "0")}.000Z`,
        type: "response_item",
        payload: {
          type: "message",
          role: i % 2 === 0 ? "user" : "assistant",
          content: [{ type: "input_text", text: `padding ${i}` }]
        }
      })
    );
    const skippedRecords = [
      JSON.stringify({
        timestamp: "2026-06-09T05:50:38.000Z",
        type: "event_msg",
        payload: { msg: "event metadata stays" }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:39.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-001", cwd: "/home/user/project" }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:40.000Z",
        type: "response_item",
        payload: { type: "reasoning", encrypted_content: "abc123encrypted" }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:41.000Z",
        type: "compacted",
        payload: { message: "compaction marker stays" }
      })
    ];
    const original = [
      JSON.stringify({
        timestamp: "2026-06-09T05:50:37.175Z",
        type: "session_meta",
        payload: {
          id: "test-session-002",
          base_instructions: { text: "You are a helpful assistant." }
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:42.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Use old payment endpoint legacy charge api" }]
        }
      }),
      ...skippedRecords,
      JSON.stringify({
        timestamp: "2026-06-09T05:50:43.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Use old payment endpoint legacy charge api" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-09T05:50:44.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Correction: instead use new billing endpoint" }]
        }
      }),
      ...padding
    ].join("\n");
    await writeFile(input, original, "utf8");

    const result = await compressFile(input, output, { recentWindow: 0 });
    const compressed = await readFile(output, "utf8");
    const compactMarker = result.report.messages.find((message) => message.content.includes("compaction marker stays"));
    const removedTokenTotal = result.report.remove_candidates.reduce((sum, message) => sum + message.tokens, 0);

    expect((compressed.match(/legacy charge api/g) ?? [])).toHaveLength(2);
    expect(compressed).toContain("event metadata stays");
    expect(compressed).toContain("turn-001");
    expect(compressed).toContain("abc123encrypted");
    expect(compressed).toContain("compaction marker stays");
    expect(compressed).toContain("new billing endpoint");
    expect(compactMarker?.protected).toBe(true);
    expect(compactMarker?.decision).toBe("keep_protected");
    expect(result.report.remove_candidates.some((message) => message.id === compactMarker?.id)).toBe(false);
    expect(result.report.summary.estimated_saving_tokens).toBe(removedTokenTotal);
    expect(result.report.warnings.join("\n")).toContain("session_compacted");
    expect(original.split("\n").length - compressed.split("\n").length).toBe(result.removedMessages);
  });

  test("rejects output paths that resolve to the input file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "session.jsonl");
    await writeFile(input, '{"role":"user","content":"hello"}\n', "utf8");

    await expect(compressFile(input, input)).rejects.toThrow(/output file must be different from input file/i);
  });

  test("removes only matching messages from OpenAI messages arrays", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "openai.jsonl");
    const output = join(dir, "openai.trimmed.jsonl");
    const padding = Array.from({ length: 35 }, (_, i) =>
      JSON.stringify({ role: i % 2 === 0 ? "user" : "assistant", content: `padding ${i}` })
    );
    const original = [
      JSON.stringify({
        messages: [
          { role: "system", content: "System stays" },
          { role: "assistant", content: "Use old payment endpoint legacy charge api" },
          { role: "assistant", content: "Use old payment endpoint legacy charge api" },
          { role: "user", content: "Correction: instead use new billing endpoint" }
        ]
      }),
      ...padding
    ].join("\n");
    await writeFile(input, original, "utf8");

    const result = await compressFile(input, output);
    const compressed = await readFile(output, "utf8");

    expect(result.removedMessages).toBe(result.report.remove_candidates.length);
    expect(result.report.summary.remove_candidates).toBe(result.report.remove_candidates.length);
    expect(compressed.split("\n")).toHaveLength(original.split("\n").length);
    expect(countOpenAiMessages(original) - countOpenAiMessages(compressed)).toBe(result.removedMessages);
    expect(compressed).toContain("System stays");
    expect(compressed).toContain("new billing endpoint");
    expect((compressed.match(/legacy charge api/g) ?? [])).toHaveLength(1);
  });

  test("keeps OpenAI messages array indices aligned when records contain skipped entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-"));
    const input = join(dir, "openai-skipped.jsonl");
    const output = join(dir, "openai-skipped.trimmed.jsonl");
    const padding = Array.from({ length: 35 }, (_, i) =>
      JSON.stringify({ role: i % 2 === 0 ? "user" : "assistant", content: `padding ${i}` })
    );
    const original = [
      JSON.stringify({
        messages: [
          { role: "system", content: "System stays" },
          "unknown raw entry stays in place",
          { role: "assistant", content: "Use old payment endpoint legacy charge api" },
          { role: "assistant", content: "Use old payment endpoint legacy charge api" },
          { role: "user", content: "Correction: instead use new billing endpoint" }
        ]
      }),
      ...padding
    ].join("\n");
    await writeFile(input, original, "utf8");

    await compressFile(input, output, { recentWindow: 0 });
    const compressed = await readFile(output, "utf8");
    const firstLine = JSON.parse(compressed.split("\n")[0]) as { messages: unknown[] };

    expect(firstLine.messages).toEqual([
      { role: "system", content: "System stays" },
      "unknown raw entry stays in place",
      { role: "assistant", content: "Use old payment endpoint legacy charge api" },
      { role: "user", content: "Correction: instead use new billing endpoint" }
    ]);
    expect((compressed.match(/legacy charge api/g) ?? [])).toHaveLength(1);
  });
});
