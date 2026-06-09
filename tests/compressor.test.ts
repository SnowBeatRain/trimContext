import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressFile } from "../src/core/compressor.js";

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

    expect(after).toBe(original);
    expect(compressed).not.toContain("old-1");
    expect(compressed).toContain("sys-1");
    expect(compressed).toContain("pad-34");
    expect(result.removedMessages).toBeGreaterThanOrEqual(1);
    expect(result.report.remove_candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true);
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

    await compressFile(input, output);
    const compressed = await readFile(output, "utf8");

    expect(compressed).toContain("System stays");
    expect(compressed).toContain("new billing endpoint");
    expect(compressed).not.toContain("legacy charge api");
  });
});
