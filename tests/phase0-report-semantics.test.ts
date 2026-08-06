import { describe, expect, test } from "vitest";
import { createPhase0ReportSemanticSha256 } from "../scripts/phase0-report-semantics.js";

describe("Phase 0 report semantic fingerprints", () => {
  test("ignores object key order at every nesting level", () => {
    const left = createPhase0ReportSemanticSha256({
      z: [1, { b: true, a: null }],
      "语义": { y: "value", x: false },
      a: "root"
    });
    const right = createPhase0ReportSemanticSha256({
      a: "root",
      "语义": { x: false, y: "value" },
      z: [1, { a: null, b: true }]
    });

    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(right).toBe(left);
  });

  test("preserves array order and every JSON primitive value", () => {
    const baseline = {
      values: [null, false, true, 0, -4.25, "private-value"],
      nested: { decision: "keep", score: 0.25 }
    };

    expect(createPhase0ReportSemanticSha256({
      ...baseline,
      values: [...baseline.values].reverse()
    })).not.toBe(createPhase0ReportSemanticSha256(baseline));
    expect(createPhase0ReportSemanticSha256({
      ...baseline,
      nested: { ...baseline.nested, score: 0.2501 }
    })).not.toBe(createPhase0ReportSemanticSha256(baseline));
    expect(createPhase0ReportSemanticSha256({
      ...baseline,
      nested: { ...baseline.nested, decision: "remove_candidate" }
    })).not.toBe(createPhase0ReportSemanticSha256(baseline));
  });

  test.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["bigint", BigInt(1)],
    ["function", () => "private-runtime-value"],
    ["symbol", Symbol("private-runtime-value")],
    ["nested undefined", { nested: undefined }]
  ])("rejects unsupported %s values", (_name, value) => {
    expect(createPhase0ReportSemanticSha256(value)).toBeUndefined();
  });

  test("rejects cyclic objects without throwing", () => {
    const cyclic: Record<string, unknown> = { value: "private-cycle" };
    cyclic.self = cyclic;

    expect(createPhase0ReportSemanticSha256(cyclic)).toBeUndefined();
  });
});
