import { describe, expect, test } from "vitest";
import { formatAnalysisSummary } from "../src/cli/format-summary.js";
import { createReport } from "../src/core/reporter.js";
import type { Finding } from "../src/types/report.js";

describe("formatAnalysisSummary", () => {
  test("uses public v2 assessment evidence and keeps unknown explicit and concise", () => {
    const report = createReport([], "session.jsonl");
    report.assessment = {
      status: "unknown",
      confidence: "low",
      summary: "Insufficient observable evidence for a reliable health label.",
      dimensions: report.assessment.dimensions,
      coverage: report.assessment.coverage,
      limitations: ["protected_coverage_too_high"]
    };
    report.findings = [finding("first"), finding("second"), finding("third")];
    report.resume.readiness.missing = ["current goal", "next steps"];
    report.recommendations = [
      { code: "write_report", priority: 1, summary: "Inspect the full report first." },
      { code: "new_chat", priority: 2, summary: "This second recommendation must stay hidden." }
    ];

    const summary = formatAnalysisSummary(report);

    expect(summary).toContain("状态: UNKNOWN");
    expect(summary).toContain("置信度: LOW");
    expect(summary).toContain("protected 内容占比过高");
    expect(summary).toContain("current goal, next steps");
    expect(summary).toContain("first");
    expect(summary).toContain("second");
    expect(summary).not.toContain("third");
    expect(summary).toContain("Inspect the full report first.");
    expect(summary).not.toContain("This second recommendation must stay hidden.");
    expect(summary.indexOf("-o report.md")).toBeLessThan(summary.indexOf("-o report.json"));
    expect(summary).not.toContain("conversation is clean");
    expect(summary).not.toContain("health: OK");
    expect(summary).not.toContain("breakdown:");
    expect(summary).not.toContain("max score:");
    expect(summary).not.toContain("token mix:");
  });
});

function finding(title: string): Finding {
  return {
    id: title,
    type: "duplicate",
    severity: "warning",
    confidence: "high",
    code: "exact_duplicate",
    title,
    explanation: `${title} evidence`,
    summary: `${title} summary`,
    impact: { message_count: 1, tokens: 10, token_ratio: 0.1 },
    suggested_action: "keep_canonical_message",
    tokens: 10,
    evidence: []
  };
}
