import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("phase0 validation summary", () => {
  test("writes a private-safe markdown aggregate next to phase0-results.json", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-summary-"));

    await execFileAsync(
      "node",
      ["--import", "tsx", "scripts/phase0-run.ts", "--dir", "tests/fixtures", "--out", outDir],
      { cwd: process.cwd() }
    );

    const summary = await readFile(join(outDir, "validation-summary.md"), "utf8");
    expect(summary).toContain("# Phase 0 Validation Summary");
    expect(summary).toContain("## Aggregate");
    expect(summary).toContain("| Samples | 4 |");
    expect(summary).toContain("| Analyze OK | 4/4 |");
    expect(summary).toContain("| Input unchanged | 4/4 |");
    expect(summary).toContain("## Source Coverage");
    expect(summary).toContain("claude-code-jsonl");
    expect(summary).toContain("codex-jsonl");
    expect(summary).toContain("openai-jsonl");
    expect(summary).toContain("## Safety Notes");
    expect(summary).toContain("`phase0-results.json` is private by default");
    expect(summary).toContain("local paths, stderr, or error details");
    expect(summary).not.toContain("Use old payment endpoint");
  });
});
