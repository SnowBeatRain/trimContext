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
});
