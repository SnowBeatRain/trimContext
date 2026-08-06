import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
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
    const results = JSON.parse(await readFile(join(outDir, "phase0-results.json"), "utf8")) as {
      sample_count: number;
      aggregate: {
        analyze_ok: number;
        analyze_report_matched: number;
        input_sha256_bound: number;
        input_unchanged: number;
        failed_samples: string[];
      };
      results: unknown[];
    };
    const fixtureCount = (await readdir(join(process.cwd(), "tests", "fixtures")))
      .filter((file) => file.endsWith(".jsonl")).length;

    expect(results.sample_count).toBe(fixtureCount);
    expect(results.results).toHaveLength(fixtureCount);
    expect(summary).toContain("# Phase 0 Validation Summary");
    expect(summary).toContain("## Aggregate");
    expect(summary).toContain(`| Samples | ${fixtureCount} |`);
    expect(summary).toContain(`| Analyze OK | ${results.aggregate.analyze_ok}/${fixtureCount} |`);
    expect(results.aggregate.analyze_report_matched).toBe(fixtureCount);
    expect(results.aggregate.input_sha256_bound).toBe(fixtureCount);
    expect(results.aggregate.failed_samples).toEqual([]);
    expect(summary).toContain(`| Analyze/report semantics matched | ${fixtureCount}/${fixtureCount} |`);
    expect(summary).toContain(`| Command inputs SHA-256 bound | ${fixtureCount}/${fixtureCount} |`);
    expect(summary).toContain(`| Input unchanged | ${results.aggregate.input_unchanged}/${fixtureCount} |`);
    expect(summary).toContain("## Source Coverage");
    expect(summary).toContain("claude-code-jsonl");
    expect(summary).toContain("codex-jsonl");
    expect(summary).toContain("openai-jsonl");
    expect(summary).toContain("## Manual Review Metrics");
    expect(summary).toContain("| Remove candidate precision | Pending manual review |");
    expect(summary).toContain("| Critical false deletion | Pending manual review |");
    expect(summary).toContain("| Protected reviewed | Pending manual review |");
    expect(summary).toContain("| Protected keep | Pending manual review |");
    expect(summary).toContain("| Protected recall | Pending manual review |");
    expect(summary).toContain("| Critical protected reviewed | Pending manual review |");
    expect(summary).toContain("| Non-critical protected reviewed | Pending manual review |");
    expect(summary).toContain("| Protected sample coverage | Pending manual review |");
    expect(summary).toContain("| Protected review requirement met | Pending manual review |");
    expect(summary).toContain("| Needs summary | Pending manual review |");
    expect(summary).toContain("| Unclear | Pending manual review |");
    expect(summary).toContain("## Known Gaps");
    expect(summary).toContain("Real private OpenAI export validation is pending");
    expect(summary).toContain("Phase 0 is not complete until manual review metrics are recorded");
    expect(summary).toContain("## Safety Notes");
    expect(summary).toContain("`phase0-results.json` is private by default");
    expect(summary).toContain("local paths, stderr, or error details");
    expect(summary).not.toContain("Use old payment endpoint");
  });
});
