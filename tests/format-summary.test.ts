import { describe, expect, test } from "vitest";
import { formatAnalysisSummary, formatUserSummary } from "../src/cli/format-summary.js";
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
    report.findings = [limitationFinding(), finding("first"), finding("second"), finding("third")];
    report.resume.readiness.missing = ["current goal", "next steps"];
    report.recommendations = [
      { code: "write_report", priority: 1, summary: "Inspect the full report first." },
      { code: "new_chat", priority: 2, summary: "This second recommendation must stay hidden." }
    ];

    const summary = formatAnalysisSummary(report);

    expect(summary).toContain("状态: 未知");
    expect(summary).toContain("置信度: 低");
    expect(summary).toContain("结论: 可观测证据不足，无法给出可靠的健康判断。");
    expect(summary).toContain("Protected 内容占比过高");
    expect(summary).toContain("续接缺失: 当前目标、下一步");
    expect(summary).not.toContain("Assessment limitation");
    expect(summary).toContain("first");
    expect(summary).toContain("second");
    expect(summary).not.toContain("third");
    expect(summary).toContain("先生成完整 JSON 报告，再判断会话健康状态。");
    expect(summary).not.toContain("Inspect the full report first.");
    expect(summary).not.toContain("This second recommendation must stay hidden.");
    expect(summary.indexOf("-o report.md")).toBeLessThan(summary.indexOf("-o report.json"));
    expect(summary).not.toContain("conversation is clean");
    expect(summary).not.toContain("health: OK");
    expect(summary).not.toContain("breakdown:");
    expect(summary).not.toContain("max score:");
    expect(summary).not.toContain("token mix:");

    const userSummary = formatUserSummary(report);
    expect(userSummary).toContain("状态: 未知");
    expect(userSummary).toContain("置信度: 低");
    expect(userSummary).toContain("- 可观测证据不足，无法给出可靠的健康判断。");
    expect(userSummary).toContain("续接缺失: 当前目标、下一步");
    expect(userSummary).not.toContain("Assessment limitation");
  });

  test("localizes only the continuation evidence named by readiness", () => {
    const report = createReport([], "session.jsonl");
    report.resume.readiness = {
      score: 60,
      level: "partial",
      missing: ["user decisions", "active files", "test signals"],
      signals: {
        current_goal: true,
        decisions: false,
        active_files: false,
        test_signals: false,
        next_steps: true
      }
    };
    report.recommendations = [{
      code: "clarify_continuation",
      priority: 1,
      summary: "machine copy must stay hidden"
    }];

    const summary = formatAnalysisSummary(report);

    expect(summary).toContain("- 继续会话前，补充缺失的用户决策、活跃文件、测试信号。");
    expect(summary).not.toContain("先明确当前目标和下一步");
    expect(summary).not.toContain("machine copy must stay hidden");
  });
});

function limitationFinding(): Finding {
  return {
    id: "limitation:protected_coverage_too_high",
    type: "limitation",
    severity: "info",
    confidence: "low",
    code: "protected_coverage_too_high",
    title: "Assessment limitation: protected_coverage_too_high",
    explanation: "Coverage limits the confidence of the overall health assessment.",
    summary: "Assessment limitation: protected_coverage_too_high.",
    impact: { message_count: 0, tokens: 0, token_ratio: 0 },
    suggested_action: "collect_more_evidence",
    tokens: 0,
    evidence: []
  };
}

function finding(title: string): Finding {
  return {
    id: title,
    type: "duplicate",
    severity: "warning",
    confidence: "high",
    code: title,
    title,
    explanation: `${title} evidence`,
    summary: `${title} summary`,
    impact: { message_count: 1, tokens: 10, token_ratio: 0.1 },
    suggested_action: "keep_canonical_message",
    tokens: 10,
    evidence: []
  };
}
