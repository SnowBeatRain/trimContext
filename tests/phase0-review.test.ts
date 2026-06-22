import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("phase0 manual review metrics", () => {
  test("summarizes labels into trust gates without exposing raw content", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v1",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false },
        { id: "m2", decision: "remove_candidate", protected: false },
        { id: "m3", decision: "keep_protected", protected: true },
        { id: "m4", decision: "keep", protected: false }
      ]
    }), "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "duplicate" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "remove_candidate", label: "critical_keep", review_note: "contains user decision" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "must preserve" }),
      JSON.stringify({ sample_id: "sample", message_id: "m4", decision: "keep", label: "missed_low_value_noise", review_note: "could remove" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.schema_version).toBe("trimctx.phase0.review.v1");
    expect(output.metrics).toMatchObject({
      critical_false_deletion: 1,
      protected_recall: 1,
      remove_candidate_precision: 0.5
    });
    expect(output.gates_passed).toBe(false);
    expect(output.trust_status).toBe("failed");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("# Phase 0 Manual Review");
    expect(summary).toContain("| Critical false deletion | 1 | 0 | FAIL |");
    expect(summary).toContain("| Protected recall | 100.0% | 100.0% | PASS |");
    expect(summary).toContain("| Remove candidate precision | 50.0% | 70.0% | FAIL |");
    expect(summary).not.toContain("contains user decision");
  });

  test("keeps trust review_required when labels contain quality issues", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v1",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false },
        { id: "m2", decision: "keep_protected", protected: true }
      ]
    }), "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "valid" }),
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "duplicate" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep", label: "protected_keep", review_note: "private reviewer note" }),
      JSON.stringify({ sample_id: "sample", message_id: "missing", decision: "remove_candidate", label: "safe_remove", review_note: "sensitive source detail" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.metrics).toMatchObject({
      label_quality_issues: 3,
      unknown_label_references: 1,
      duplicate_labels: 1,
      decision_mismatches: 1
    });
    expect(output.gates_passed).toBe(false);
    expect(output.trust_status).toBe("review_required");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("## Label Quality");
    expect(summary).toContain("| Unknown label references | 1 |");
    expect(summary).toContain("| Duplicate labels | 1 |");
    expect(summary).toContain("| Decision mismatches | 1 |");
    expect(summary).not.toContain("duplicate");
    expect(summary).not.toContain("private reviewer note");
    expect(summary).not.toContain("sensitive source detail");
  });
});

async function createReviewFixture(): Promise<{ root: string; reportsDir: string; labelsDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-review-"));
  const reportsDir = join(root, "reports");
  const labelsDir = join(root, "labels");
  await mkdir(reportsDir, { recursive: true });
  await mkdir(labelsDir, { recursive: true });
  return { root, reportsDir, labelsDir };
}

async function runReview(reportsDir: string, labelsDir: string, outDir: string): Promise<void> {
  await execFileAsync("node", ["--import", "tsx", "scripts/phase0-review.ts", "--reports", reportsDir, "--labels", labelsDir, "--out", outDir], {
    cwd: process.cwd()
  });
}
