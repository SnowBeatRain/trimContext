import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import type { AnalysisReport } from "../src/types/report.js";

const execFileAsync = promisify(execFile);

describe("analyze CLI", () => {
  test("prints a short human summary by default", async () => {
    const file = await writeSessionFixture();
    const { stdout } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", "analyze", file], {
      cwd: process.cwd()
    });

    expect(stdout).toContain("trimctx analysis");
    expect(stdout).toContain("messages /");
    expect(stdout).toContain("tokens");
    expect(stdout).toContain("tokenizer:");
    expect(stdout).toContain("health:");
    expect(stdout).toContain("rot:");
    expect(stdout).toContain("resume:");
    expect(stdout).toContain("readiness:");
    expect(stdout).toContain("next:");
    expect(stdout).not.toContain('"messages": [');
  });

  test("prints the full JSON report when --json is passed", async () => {
    const file = await writeSessionFixture();
    const { stdout } = await execFileAsync("node", ["--import", "tsx", "src/cli.ts", "analyze", file, "--json"], {
      cwd: process.cwd()
    });

    const report = JSON.parse(stdout) as AnalysisReport;
    expect(report.schema_version).toBe("trimctx.report.v1");
    expect(report.messages.length).toBeGreaterThan(0);
    expect(report.summary.top_reasons.length).toBeGreaterThan(0);
    expect(report.tokenization).toEqual({ tokenizer: "local_heuristic", confidence: "medium" });
    expect(report.resume.readiness.level).toBe("blocked");
    expect(report.remove_candidates.every((candidate) => candidate.reasons.length > 0)).toBe(true);
  });
});

async function writeSessionFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trimctx-cli-"));
  const file = join(dir, "session.jsonl");
  const lines = [
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
  ];
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}
