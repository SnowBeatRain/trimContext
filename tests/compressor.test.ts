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
    const original = [
      '{"type":"assistant","uuid":"old-1","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
      '{"type":"assistant","uuid":"old-2","message":{"role":"assistant","content":"Use old payment endpoint legacy charge api"}}',
      '{"type":"user","uuid":"new-1","message":{"role":"user","content":"Correction: instead use new billing endpoint"}}',
      '{"type":"assistant","uuid":"new-2","message":{"role":"assistant","content":"Okay use new billing endpoint"}}',
      '{"type":"system","uuid":"sys-1","message":{"role":"system","content":"System stays"}}',
      '{"type":"user","uuid":"r1","message":{"role":"user","content":"recent 1"}}',
      '{"type":"assistant","uuid":"r2","message":{"role":"assistant","content":"recent 1 answer"}}',
      '{"type":"user","uuid":"r3","message":{"role":"user","content":"recent 2"}}',
      '{"type":"assistant","uuid":"r4","message":{"role":"assistant","content":"recent 2 answer"}}',
      '{"type":"user","uuid":"r5","message":{"role":"user","content":"recent 3"}}',
      '{"type":"assistant","uuid":"r6","message":{"role":"assistant","content":"recent 3 answer"}}',
      '{"type":"user","uuid":"r7","message":{"role":"user","content":"recent 4"}}',
      '{"type":"assistant","uuid":"r8","message":{"role":"assistant","content":"recent 4 answer"}}',
      '{"type":"user","uuid":"r9","message":{"role":"user","content":"recent 5"}}',
      '{"type":"assistant","uuid":"r10","message":{"role":"assistant","content":"recent 5 answer"}}',
      '{"type":"user","uuid":"r11","message":{"role":"user","content":"recent 6"}}',
      '{"type":"assistant","uuid":"r12","message":{"role":"assistant","content":"recent 6 answer"}}'
    ].join("\n");
    await writeFile(input, original, "utf8");

    const result = await compressFile(input, output);
    const after = await readFile(input, "utf8");
    const compressed = await readFile(output, "utf8");

    expect(after).toBe(original);
    expect(compressed).not.toContain("old-1");
    expect(compressed).toContain("sys-1");
    expect(compressed).toContain("r12");
    expect(result.removedMessages).toBeGreaterThanOrEqual(1);
    expect(result.report.remove_candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true);
  });
});
