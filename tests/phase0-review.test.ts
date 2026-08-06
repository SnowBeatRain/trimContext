import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { createPhase0ReportSemanticSha256 } from "../scripts/phase0-report-semantics.js";

const execFileAsync = promisify(execFile);

describe("phase0 manual review metrics", () => {
  test("keeps trust review_required when batch validation evidence is missing", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, rot_score: 0.1 }
      ]
    }), "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output).not.toHaveProperty("reports_dir");
    expect(output).not.toHaveProperty("labels_dir");
    expect(output.metrics.remove_candidate_precision).toBe(1);
    expect(output.metrics.protected_recall).toBe(1);
    expect(output.validation).toMatchObject({
      available: false,
      ready: false,
      passed: false,
      issues: ["missing_phase0_results"]
    });
    expect(output.gates_passed).toBe(false);
    expect(output.trust_status).toBe("review_required");
  });

  test("summarizes labels into trust gates without exposing raw content", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m3", decision: "keep_protected", protected: true, rot_score: 0.1 },
        { id: "m4", decision: "keep", protected: false, rot_score: 0.1 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "duplicate" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "remove_candidate", label: "critical_keep", review_note: "contains user decision" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "must preserve" }),
      JSON.stringify({ sample_id: "sample", message_id: "m4", decision: "keep", label: "missed_low_value_noise", review_note: "could remove" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.schema_version).toBe("trimctx.phase0.review.v2");
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

  test("accepts legacy critical_false_delete labels as critical false deletion evidence", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 }
      ]
    }), "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "critical_false_delete", review_note: "private reviewer note" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "must preserve" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.metrics).toMatchObject({
      critical_false_deletion: 1,
      remove_candidates_reviewed: 1,
      remove_candidate_precision: 0,
      invalid_label_decisions: 0,
      label_quality_issues: 0
    });
    expect(output.trust_status).toBe("review_required");
    expect(json).not.toContain("critical_false_delete");
    expect(json).not.toContain("private reviewer note");
  });

  test("accepts unclear and needs_summary labels as non-locking review evidence", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 },
        { id: "m3", decision: "compress_candidate", protected: false, reasons: ["near_remove_threshold"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "unclear", review_note: "private uncertainty" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "must preserve" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "compress_candidate", label: "needs_summary", review_note: "private summary note" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.metrics).toMatchObject({
      label_quality_issues: 0,
      remove_candidates_reviewed: 0,
      remove_candidate_precision: null,
      protected_reviewed: 1,
      protected_recall: 1,
      unclear: 1,
      needs_summary: 1
    });
    expect(output.trust_status).toBe("review_required");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Unclear | 1 |");
    expect(summary).toContain("| Needs summary | 1 |");
    for (const privateValue of ["private uncertainty", "private summary note"]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("locks trust when critical protected are complete and non-critical protected are sampled", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["system_or_developer_message"], rot_score: 0.7 },
        { id: "m3", decision: "keep_protected", protected: true, reasons: ["contains_tool_interaction"], rot_score: 0.8 },
        { id: "m4", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 },
        { id: "m5", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.2 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "duplicate" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "system" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "tool" }),
      JSON.stringify({ sample_id: "sample", message_id: "m4", decision: "keep_protected", label: "protected_keep", review_note: "sampled recent" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.metrics).toMatchObject({
      remove_candidates: 1,
      remove_candidates_reviewed: 1,
      critical_protected_messages: 2,
      critical_protected_reviewed: 2,
      protected_messages: 4,
      protected_reviewed: 3,
      protected_sample_coverage: 0.5,
      protected_review_requirement_met: true,
      critical_false_deletion: 0,
      protected_recall: 1,
      remove_candidate_precision: 1
    });
    expect(output.gates_passed).toBe(true);
    expect(output.trust_status).toBe("locked");
    expect(output.validation.input_sha256_bound).toBe(5);

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Command inputs SHA-256 bound | 5/5 |");
    expect(summary).toContain("| Critical protected messages | 2 |");
    expect(summary).toContain("| Critical protected reviewed | 2 |");
    expect(summary).toContain("| Protected sample coverage | 50.0% |");
    expect(summary).toContain("critical protected messages plus a sampled subset of other protected messages");
  });

  test("keeps trust review_required when label categories do not match report decisions", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["contains_tool_interaction"], rot_score: 0.7 },
        { id: "m3", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 },
        { id: "m4", decision: "compress_candidate", protected: false, reasons: ["near_remove_threshold"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "critical protected" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "sampled protected" }),
      JSON.stringify({ sample_id: "sample", message_id: "m4", decision: "compress_candidate", label: "safe_remove", review_note: "private category mismatch" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      label_quality_issues: 1,
      incompatible_label_categories: 1,
      remove_candidate_precision: 1,
      protected_recall: 1
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Incompatible label categories | 1 |");
    expect(summary).not.toContain("private category mismatch");
  });

  test("keeps trust review_required when the current report is not Report v2", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v1",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["system_or_developer_message"], rot_score: 0.7 },
        { id: "m3", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "critical protected" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "sampled protected" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      report_quality_issues: 1,
      invalid_report_schemas: 1
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Invalid report schemas | 1 |");
    expect(summary).not.toContain("trimctx.report.v1");
  });

  test("keeps trust review_required when older v2 evidence lacks command input binding", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["system_or_developer_message"], rot_score: 0.7 },
        { id: "m3", decision: "keep_protected", protected: true, reasons: ["contains_tool_interaction"], rot_score: 0.8 },
        { id: "m4", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.1 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir, { omitInputBindingEvidence: true });
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "duplicate" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "system" }),
      JSON.stringify({ sample_id: "sample", message_id: "m3", decision: "keep_protected", label: "protected_keep", review_note: "tool" }),
      JSON.stringify({ sample_id: "sample", message_id: "m4", decision: "keep_protected", label: "protected_keep", review_note: "recent" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.gates_passed).toBe(false);
    expect(output.trust_status).toBe("review_required");
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      input_sha256_bound: 0,
      issues: ["input_sha256_binding_unavailable"]
    });
    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Command inputs SHA-256 bound | 0/5 |");
    expect(summary).toContain("input_sha256_binding_unavailable");
    expect(json).not.toContain("C:\\private\\phase0-secret");
  });

  test("keeps trust review_required when report sources contradict batch coverage", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir, { allReportSourcesClaude: true });
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 5,
      matched_report_sources: 2,
      source_counts: {
        "claude-code-jsonl": 5,
        "openai-jsonl": 0,
        "codex-jsonl": 0
      }
    });
    expect(output.validation.issues).toEqual(expect.arrayContaining([
      "report_source_mismatch",
      "insufficient_openai_samples",
      "insufficient_codex_samples"
    ]));

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Report sources matched | 2/5 |");
    expect(summary).toContain("report_source_mismatch");
    expect(json).not.toContain("C:\\private\\phase0-secret");
    expect(summary).not.toContain("C:\\private\\phase0-secret");
  });

  test("keeps trust review_required when report inputs contradict batch samples", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir, { allReportInputsOther: true });
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 5,
      matched_report_sources: 5,
      matched_report_inputs: 0
    });
    expect(output.validation.issues).toContain("report_input_mismatch");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Report inputs matched | 0/5 |");
    expect(summary).toContain("report_input_mismatch");
    expect(json).not.toContain("C:\\private\\phase0-other");
    expect(summary).not.toContain("C:\\private\\phase0-other");
  });

  test("keeps trust review_required when successful compressed artifacts are missing", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir, { omitCompressedArtifacts: true });
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      expected_compressed_artifacts: 5,
      matched_compressed_artifacts: 0
    });
    expect(output.validation.issues).toContain("compressed_set_mismatch");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Compressed artifacts matched | 0/5 |");
    expect(summary).toContain("compressed_set_mismatch");
    expect(json).not.toContain(".trimmed.jsonl");
    expect(summary).not.toContain(".trimmed.jsonl");
  });

  test("keeps trust review_required when a compressed artifact changes after batch validation", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const privateSentinel = "private-replaced-compressed-content";

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    const compressedFile = join(reportsDir, "sample.trimmed.jsonl");
    const compressedRows = (await readFile(compressedFile, "utf8")).trimEnd().split("\n");
    const firstRow = JSON.parse(compressedRows[0]!) as Record<string, unknown>;
    compressedRows[0] = JSON.stringify({ ...firstRow, private: privateSentinel });
    await writeFile(compressedFile, `${compressedRows.join("\n")}\n`, "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 4,
      issues: ["compressed_hash_mismatch"]
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Compressed hashes matched | 4/5 |");
    expect(summary).toContain("compressed_hash_mismatch");
    for (const privateValue of [
      privateSentinel,
      compressedFile,
      createHash("sha256").update(`${privateSentinel}\n`).digest("hex")
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("keeps trust review_required when current compressed bytes contain malformed JSONL", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const privateSentinel = "private-malformed-review-compressed";
    const malformed = `{"type":"assistant","private":"${privateSentinel}"`;

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    const compressedFile = join(reportsDir, "sample.trimmed.jsonl");
    await writeFile(compressedFile, malformed, "utf8");
    await updateResultCompressedDigest(reportsDir, "sample", malformed);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 4,
      matched_compressed_message_sets: 4,
      issues: ["compressed_structure_invalid"]
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Compressed structures valid | 4/5 |");
    expect(summary).toContain("compressed_structure_invalid");
    for (const privateValue of [
      privateSentinel,
      compressedFile,
      createHash("sha256").update(malformed).digest("hex")
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("keeps trust review_required when compressed messages drift from report decisions", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const privateSentinel = "private-semantic-review-compressed";

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    const compressedFile = join(reportsDir, "sample.trimmed.jsonl");
    const original = await readFile(compressedFile, "utf8");
    const drifted = `${original}${JSON.stringify({
      type: "assistant",
      uuid: "private-extra-message-id",
      message: { role: "assistant", content: privateSentinel }
    })}\n`;
    await writeFile(compressedFile, drifted, "utf8");
    await updateResultCompressedDigest(reportsDir, "sample", drifted);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 5,
      matched_compressed_message_sets: 4,
      issues: ["compressed_message_set_mismatch"]
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Compressed message sets matched | 4/5 |");
    expect(summary).toContain("compressed_message_set_mismatch");
    for (const privateValue of [
      privateSentinel,
      compressedFile,
      createHash("sha256").update(drifted).digest("hex"),
      "private-extra-message-id"
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("keeps trust review_required when a report changes after batch validation", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const privateSentinel = "private-replaced-report-content";
    const report = {
      schema_version: "trimctx.report.v2",
      input: {
        file: "C:\\private\\phase0-secret\\sample.jsonl",
        source: "claude-code-jsonl"
      },
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    };
    const reportFile = join(reportsDir, "sample.report.json");

    await writeFile(reportFile, JSON.stringify(report), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    const validatedReport = JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>;
    await writeFile(
      reportFile,
      JSON.stringify({ ...validatedReport, private: privateSentinel }),
      "utf8"
    );
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 4,
      matched_analyze_report_semantics: 4,
      issues: ["analyze_report_semantic_mismatch", "report_hash_mismatch"]
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Report hashes matched | 4/5 |");
    expect(summary).toContain("report_hash_mismatch");
    expect(json).not.toContain(privateSentinel);
    expect(summary).not.toContain(privateSentinel);
  });

  test("keeps trust review_required when analyze semantics differ from the current report", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const privateSentinel = "private-analyze-report-semantic-drift";
    const reportFile = join(reportsDir, "sample.report.json");
    await writeFile(reportFile, JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);

    const resultsFile = join(reportsDir, "phase0-results.json");
    const evidence = JSON.parse(await readFile(resultsFile, "utf8")) as {
      results: Array<{
        sample: string;
        analyze_report: { status: string; analyze_semantic_sha256?: string };
      }>;
    };
    const sample = evidence.results.find((result) => result.sample.endsWith("\\sample.jsonl"));
    if (!sample) throw new Error("Expected sample semantic evidence");
    const privateSemanticSha256 = createHash("sha256").update(privateSentinel).digest("hex");
    sample.analyze_report.analyze_semantic_sha256 = privateSemanticSha256;
    await writeFile(resultsFile, JSON.stringify(evidence), "utf8");

    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.validation).toMatchObject({
      ready: false,
      passed: false,
      expected_analyze_report_pairs: 5,
      matched_analyze_report_semantics: 4,
      issues: ["analyze_report_semantic_mismatch"]
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Expected analyze/report pairs | 5 |");
    expect(summary).toContain("| Analyze/report semantics matched | 4/5 |");
    expect(summary).toContain("analyze_report_semantic_mismatch");
    for (const privateValue of [
      privateSentinel,
      privateSemanticSha256,
      resultsFile,
      reportFile
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("keeps trust review_required when a candidate has no reasons", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "private-compress-id", decision: "compress_candidate", protected: false, reasons: [], rot_score: 0.7 },
        { id: "private-invalid-reasons-id", decision: "compress_candidate", protected: false, reasons: "private-invalid-reasons-value", rot_score: 0.7 },
        { id: "m2", decision: "keep_protected", protected: true, reasons: ["recent_message"], rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      report_quality_issues: 2,
      missing_candidate_reasons: 2
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Missing candidate reasons | 2 |");
    for (const privateValue of [
      "private-compress-id",
      "private-invalid-reasons-id",
      "private-invalid-reasons-value"
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("keeps trust review_required when report message ids are duplicated", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "duplicate-remove", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "duplicate-remove", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "protected", decision: "keep_protected", protected: true, rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "duplicate-remove", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "protected", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      report_quality_issues: 1,
      duplicate_message_ids: 1
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("## Report Quality");
    expect(summary).toContain("| Duplicate message IDs | 1 |");
    expect(summary).not.toContain("duplicate-remove");
  });

  test("aggregates malformed report messages without exposing their values", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        null,
        { id: "   ", decision: "keep", protected: false, rot_score: 0.1 },
        { id: "private-bad-decision-id", decision: "private-bad-decision", protected: false, rot_score: 0.1 },
        { id: "private-bad-protected-id", decision: "keep", protected: "private-bad-protected", rot_score: 0.1 },
        { id: "private-bad-score-id", decision: "keep", protected: false, rot_score: "private-bad-score" },
        { id: "private-mismatch-id", decision: "keep_protected", protected: false, rot_score: 0.1 },
        { id: "valid-remove", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "valid-protected", decision: "keep_protected", protected: true, rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "valid-remove", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "valid-protected", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      report_quality_issues: 6,
      invalid_message_records: 1,
      missing_message_ids: 1,
      duplicate_message_ids: 0,
      invalid_message_decisions: 1,
      invalid_protected_flags: 1,
      invalid_rot_scores: 1,
      inconsistent_protection_decisions: 1
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("## Report Quality");
    expect(summary).toContain("| Report quality issues | 6 |");
    for (const privateValue of [
      "private-bad-decision-id",
      "private-bad-decision",
      "private-bad-protected-id",
      "private-bad-protected",
      "private-bad-score-id",
      "private-bad-score",
      "private-mismatch-id"
    ]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("rejects malformed report JSON without exposing its contents or changing outputs", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const reportFile = join(reportsDir, "sample.report.json");
    const privateSentinel = "private-report-content";

    await writeFile(reportFile, `{"messages":["${privateSentinel}"\n`, "utf8");
    await writeFile(join(labelsDir, "labels.jsonl"), "{}\n", "utf8");
    await writeFile(join(root, "phase0-review.json"), "old-json\n", "utf8");
    await writeFile(join(root, "phase0-review.md"), "old-markdown\n", "utf8");

    const stderr = await reviewFailureStderr(reportsDir, labelsDir, root);

    expect(stderr).toBe(`Invalid report JSON: ${reportFile}\n`);
    expect(stderr).not.toContain(privateSentinel);
    expect(await readFile(join(root, "phase0-review.json"), "utf8")).toBe("old-json\n");
    expect(await readFile(join(root, "phase0-review.md"), "utf8")).toBe("old-markdown\n");
  });

  test("preserves the existing review pair when an output target is invalid", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");
    await writeFile(join(root, "phase0-review.json"), "old-json\n", "utf8");
    await mkdir(join(root, "phase0-review.md"));

    await expect(runReview(reportsDir, labelsDir, root)).rejects.toThrow();

    expect(await readFile(join(root, "phase0-review.json"), "utf8")).toBe("old-json\n");
    expect((await readdir(root)).filter((name) =>
      name.includes(".trimctx-") && (name.endsWith(".stage") || name.endsWith(".bak"))
    )).toEqual([]);
  });

  test("keeps trust review_required when labels contain quality issues", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, rot_score: 0.1 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
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

  test("keeps trust review_required when labels omit required audit fields", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, rot_score: 0.7 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir);
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({
        sample_id: "sample",
        message_id: "m1",
        decision: "private-invalid-label-decision",
        label: "critical_keep",
        review_note: "private-valid-review-note"
      }),
      JSON.stringify({
        sample_id: "sample",
        message_id: "m2",
        decision: "keep_protected",
        label: "protected_keep",
        review_note: "   "
      })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const json = await readFile(join(root, "phase0-review.json"), "utf8");
    const output = JSON.parse(json);
    expect(output.trust_status).toBe("review_required");
    expect(output.gates_passed).toBe(false);
    expect(output.metrics).toMatchObject({
      critical_false_deletion: 1,
      remove_candidates_reviewed: 0,
      safe_remove: 0,
      remove_candidate_precision: null,
      protected_reviewed: 0,
      protected_keep: 0,
      protected_recall: null,
      critical_protected_reviewed: 0,
      label_quality_issues: 2,
      invalid_label_decisions: 1,
      missing_review_notes: 1
    });

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("| Invalid label decisions | 1 |");
    expect(summary).toContain("| Missing review notes | 1 |");
    for (const privateValue of ["private-invalid-label-decision", "private-valid-review-note"]) {
      expect(json).not.toContain(privateValue);
      expect(summary).not.toContain(privateValue);
    }
  });

  test("rejects non-object label records without exposing internal errors or changing outputs", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const labelsFile = join(labelsDir, "labels.jsonl");

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: []
    }), "utf8");
    await writeFile(labelsFile, "null\n", "utf8");
    await writeFile(join(root, "phase0-review.json"), "old-json\n", "utf8");
    await writeFile(join(root, "phase0-review.md"), "old-markdown\n", "utf8");

    const stderr = await reviewFailureStderr(reportsDir, labelsDir, root);

    expect(stderr).toBe(`Invalid label record at ${labelsFile}:1\n`);
    expect(stderr).not.toContain("Cannot read properties");
    expect(await readFile(join(root, "phase0-review.json"), "utf8")).toBe("old-json\n");
    expect(await readFile(join(root, "phase0-review.md"), "utf8")).toBe("old-markdown\n");
  });

  test("rejects malformed label JSON without exposing its contents or changing outputs", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();
    const labelsFile = join(labelsDir, "labels.jsonl");
    const privateSentinel = "private-reviewer-content";

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: []
    }), "utf8");
    await writeFile(labelsFile, `{"review_note":"${privateSentinel}"\n`, "utf8");
    await writeFile(join(root, "phase0-review.json"), "old-json\n", "utf8");
    await writeFile(join(root, "phase0-review.md"), "old-markdown\n", "utf8");

    const stderr = await reviewFailureStderr(reportsDir, labelsDir, root);

    expect(stderr).toBe(`Invalid label JSON at ${labelsFile}:1\n`);
    expect(stderr).not.toContain(privateSentinel);
    expect(await readFile(join(root, "phase0-review.json"), "utf8")).toBe("old-json\n");
    expect(await readFile(join(root, "phase0-review.md"), "utf8")).toBe("old-markdown\n");
  });

  test("fails trust when a complete batch misses an execution quality gate", async () => {
    const { root, reportsDir, labelsDir } = await createReviewFixture();

    await writeFile(join(reportsDir, "sample.report.json"), JSON.stringify({
      schema_version: "trimctx.report.v2",
      messages: [
        { id: "m1", decision: "remove_candidate", protected: false, reasons: ["duplicate_message"], rot_score: 0.8 },
        { id: "m2", decision: "keep_protected", protected: true, rot_score: 0.1 }
      ]
    }), "utf8");
    await writeCompleteValidationEvidence(reportsDir, { failCompress: true });
    await writeFile(join(labelsDir, "labels.jsonl"), [
      JSON.stringify({ sample_id: "sample", message_id: "m1", decision: "remove_candidate", label: "safe_remove", review_note: "safe" }),
      JSON.stringify({ sample_id: "sample", message_id: "m2", decision: "keep_protected", label: "protected_keep", review_note: "keep" })
    ].join("\n"), "utf8");

    await runReview(reportsDir, labelsDir, root);

    const output = JSON.parse(await readFile(join(root, "phase0-review.json"), "utf8"));
    expect(output.validation).toMatchObject({
      ready: true,
      passed: false,
      compress_success_rate: 0.8
    });
    expect(output.validation.issues).toContain("compress_success_rate_below_gate");
    expect(output.gates_passed).toBe(false);
    expect(output.trust_status).toBe("failed");

    const summary = await readFile(join(root, "phase0-review.md"), "utf8");
    expect(summary).toContain("## Validation Evidence");
    expect(summary).toContain("compress_success_rate_below_gate");
    expect(summary).not.toContain("C:\\private\\phase0-secret");
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

async function reviewFailureStderr(reportsDir: string, labelsDir: string, outDir: string): Promise<string> {
  try {
    await runReview(reportsDir, labelsDir, outDir);
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") return stderr;
    throw error;
  }
  throw new Error("Expected Phase 0 review to fail");
}

async function writeCompleteValidationEvidence(
  reportsDir: string,
  options: {
    failCompress?: boolean;
    allReportSourcesClaude?: boolean;
    allReportInputsOther?: boolean;
    omitCompressedArtifacts?: boolean;
    omitInputBindingEvidence?: boolean;
  } = {}
): Promise<void> {
  const samples = [
    ["sample", "claude-code-jsonl"],
    ["claude-extra", "claude-code-jsonl"],
    ["openai", "openai-jsonl"],
    ["codex-a", "codex-jsonl"],
    ["codex-b", "codex-jsonl"]
  ] as const;
  const compressedContents = new Map<string, string>();

  for (const [sample, source] of samples) {
    const reportFile = join(reportsDir, `${sample}.report.json`);
    const existing = sample === "sample"
      ? JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>
      : { schema_version: "trimctx.report.v2", messages: [] };
    const reportSource = options.allReportSourcesClaude ? "claude-code-jsonl" : source;
    const messages = normalizeFixtureReportMessages(existing.messages, reportSource, sample);
    await writeFile(reportFile, JSON.stringify({
      ...existing,
      input: {
        file: options.allReportInputsOther
          ? `C:\\private\\phase0-other\\${sample}.jsonl`
          : `C:\\private\\phase0-secret\\${sample}.jsonl`,
        source: reportSource
      },
      messages
    }), "utf8");
    compressedContents.set(
      sample,
      serializeCompressedFixture(
        reportSource,
        messages,
        sample
      )
    );
  }

  const results = await Promise.all(samples.map(async ([sample, source], index) => ({
    sample: `C:\\private\\phase0-secret\\${sample}.jsonl`,
    input_sha256_before: createHash("sha256").update(`${sample}-input`).digest("hex"),
    input_sha256_after: createHash("sha256").update(`${sample}-input`).digest("hex"),
    ...(!options.omitInputBindingEvidence ? { input_sha256_bound: true } : {}),
    input_unchanged: true,
    analyze: { ok: true, exit_code: 0 },
    analyze_report: {
      status: "matched",
      analyze_semantic_sha256: semanticSha256(
        JSON.parse(await readFile(join(reportsDir, `${sample}.report.json`), "utf8")) as unknown
      )
    },
    report: {
      ok: true,
      exit_code: 0,
      report_file: join(reportsDir, `${sample}.report.json`),
      report_sha256: createHash("sha256")
        .update(await readFile(join(reportsDir, `${sample}.report.json`)))
        .digest("hex")
    },
    compress: {
      ok: !(options.failCompress && index === samples.length - 1),
      exit_code: options.failCompress && index === samples.length - 1 ? 1 : 0,
      output_file: join(reportsDir, `${sample}.trimmed.jsonl`),
      ...(!(options.failCompress && index === samples.length - 1)
        ? {
          output_sha256: createHash("sha256")
            .update(compressedContents.get(sample)!)
            .digest("hex")
        }
        : {})
    },
    source
  })));
  if (!options.omitCompressedArtifacts) {
    await Promise.all(results.flatMap((result) => result.compress.ok
      ? [writeFile(
        result.compress.output_file,
        compressedContents.get(basename(result.compress.output_file, ".trimmed.jsonl"))!,
        "utf8"
      )]
      : []));
  }
  const aggregate = {
    analyze_ok: results.filter((result) => result.analyze.ok).length,
    analyze_report_matched: results.filter((result) => result.analyze_report.status === "matched").length,
    ...(!options.omitInputBindingEvidence
      ? { input_sha256_bound: results.length }
      : {}),
    report_ok: results.filter((result) => result.report.ok).length,
    compress_ok: results.filter((result) => result.compress.ok).length,
    input_unchanged: results.filter((result) => result.input_unchanged).length,
    failed_samples: results.filter((result) =>
      !result.input_unchanged
      || !result.analyze.ok
      || !result.report.ok
      || !result.compress.ok
      || result.analyze_report.status !== "matched"
    ).map((result) => result.sample)
  };

  await writeFile(join(reportsDir, "phase0-results.json"), JSON.stringify({
    schema_version: "trimctx.phase0.results.v2",
    generated_at: "2026-08-06T00:00:00.000Z",
    input_dir: "C:\\private\\phase0-secret",
    output_dir: reportsDir,
    sample_count: results.length,
    aggregate,
    results
  }), "utf8");
}

function semanticSha256(value: unknown): string {
  const sha256 = createPhase0ReportSemanticSha256(value);
  if (!sha256) throw new Error("Expected fixture report semantic digest");
  return sha256;
}

async function updateResultCompressedDigest(
  reportsDir: string,
  sampleId: string,
  contents: string
): Promise<void> {
  const resultsFile = join(reportsDir, "phase0-results.json");
  const evidence = JSON.parse(await readFile(resultsFile, "utf8")) as {
    results: Array<{ compress: { output_file: string; output_sha256?: string } }>;
  };
  const result = evidence.results.find((entry) =>
    basename(entry.compress.output_file, ".trimmed.jsonl") === sampleId
  );
  if (!result) throw new Error("Expected compressed result fixture");
  result.compress.output_sha256 = createHash("sha256").update(contents).digest("hex");
  await writeFile(resultsFile, JSON.stringify(evidence), "utf8");
}

interface FixtureReportMessage extends Record<string, unknown> {
  id: string;
  role: "assistant";
  content: string;
  source: "claude-code-jsonl" | "openai-jsonl" | "codex-jsonl";
  decision: string;
  timestamp?: string;
}

function normalizeFixtureReportMessages(
  value: unknown,
  source: FixtureReportMessage["source"],
  sample: string
): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : `${sample}-message-${index}`;
    return {
      ...record,
      id,
      role: "assistant",
      content: typeof record.content === "string" ? record.content : `fixture message ${id}`,
      source,
      decision: typeof record.decision === "string" ? record.decision : "keep",
      ...(source === "codex-jsonl"
        ? { timestamp: `2026-08-06T00:00:${String(index).padStart(2, "0")}.000Z` }
        : {})
    };
  });
}

function serializeCompressedFixture(
  source: FixtureReportMessage["source"],
  messages: unknown[],
  sample: string
): string {
  const retained = messages
    .filter(isFixtureReportMessage)
    .filter((message) => message.decision !== "remove_candidate");
  const lines = retained.map((message, index) => {
    if (source === "claude-code-jsonl") {
      return JSON.stringify({
        type: "assistant",
        uuid: `${sample}-compressed-${index}`,
        message: { role: "assistant", content: message.content }
      });
    }
    if (source === "codex-jsonl") {
      return JSON.stringify({
        timestamp: message.timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: message.content }]
        }
      });
    }
    return JSON.stringify({ role: "assistant", content: message.content });
  });
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function isFixtureReportMessage(value: unknown): value is FixtureReportMessage {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === "string"
    && (value as Record<string, unknown>).role === "assistant"
    && typeof (value as Record<string, unknown>).content === "string"
    && typeof (value as Record<string, unknown>).source === "string"
    && typeof (value as Record<string, unknown>).decision === "string";
}
