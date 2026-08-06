import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createPhase0RunPlan } from "../scripts/phase0-run-plan.js";

describe("phase0 run output planning", () => {
  test("preserves input order and existing output names", () => {
    const inputDir = join("private-root-marker", "inputs");
    const outputDir = join("private-root-marker", "reports");

    expect(createPhase0RunPlan([
      join(inputDir, "alpha.jsonl"),
      join(inputDir, "beta sample.jsonl")
    ], outputDir)).toEqual([
      {
        inputFile: join(inputDir, "alpha.jsonl"),
        sampleId: "alpha",
        reportFile: join(outputDir, "alpha.report.json"),
        compressedFile: join(outputDir, "alpha.trimmed.jsonl")
      },
      {
        inputFile: join(inputDir, "beta sample.jsonl"),
        sampleId: "beta_sample",
        reportFile: join(outputDir, "beta_sample.report.json"),
        compressedFile: join(outputDir, "beta_sample.trimmed.jsonl")
      }
    ]);
  });

  test("rejects names that collide after character replacement without exposing parent paths", () => {
    const privateParent = join("private-root-marker", "customer-one", "inputs");

    expect(() => createPhase0RunPlan([
      join(privateParent, "a b.jsonl"),
      join(privateParent, "a_b.jsonl")
    ], join("private-root-marker", "reports"))).toThrowError(
      'Phase 0 output name collision: "a b.jsonl" and "a_b.jsonl" both map to "a_b"'
    );

    try {
      createPhase0RunPlan([
        join(privateParent, "a b.jsonl"),
        join(privateParent, "a_b.jsonl")
      ], join("private-root-marker", "reports"));
    } catch (error) {
      expect(String(error)).not.toContain(privateParent);
    }
  });

  test("rejects names that collide after the 120 character limit", () => {
    const sharedPrefix = "x".repeat(120);

    expect(() => createPhase0RunPlan([
      join("inputs", `${sharedPrefix}a.jsonl`),
      join("inputs", `${sharedPrefix}b.jsonl`)
    ], "reports")).toThrowError(`both map to "${sharedPrefix}"`);
  });

  test.runIf(process.platform === "win32")("rejects case-equivalent output names on Windows", () => {
    expect(() => createPhase0RunPlan([
      join("inputs", "Alpha.jsonl"),
      join("inputs", "alpha.jsonl")
    ], "reports")).toThrowError(
      'Phase 0 output name collision: "Alpha.jsonl" and "alpha.jsonl" map to case-equivalent IDs "Alpha" and "alpha"'
    );
  });
});
