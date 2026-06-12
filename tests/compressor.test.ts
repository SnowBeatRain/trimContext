import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressFile } from "../src/core/compressor.js";

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

    await compressFile(input, output, { recentWindow: 0 });
    const compressed = await readFile(output, "utf8");

    expect(compressed).not.toContain("legacy charge api");
    expect(compressed).toContain("event metadata stays");
    expect(compressed).toContain("turn-001");
    expect(compressed).toContain("abc123encrypted");
    expect(compressed).toContain("compaction marker stays");
    expect(compressed).toContain("new billing endpoint");
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
    expect(compressed).not.toContain("legacy charge api");
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
      { role: "user", content: "Correction: instead use new billing endpoint" }
    ]);
    expect(compressed).not.toContain("legacy charge api");
  });
});
