import { describe, expect, test } from "vitest";
import { formatReportMarkdown } from "../src/core/report-markdown.js";
import { createReport } from "../src/core/reporter.js";

describe("formatReportMarkdown", () => {
  test("renders the v2 health report from existing evidence without exposing secrets or message bodies", () => {
    const report = createReport([], "session`danger.jsonl");
    report.assessment = {
      status: "unknown",
      confidence: "low",
      summary: "Insufficient observable evidence for a reliable health label.",
      dimensions: {
        context_pressure: { level: "low", score: 0.1, evidence_count: 1, summary: "small | sample" },
        stale_context: { level: "unknown", score: 0, evidence_count: 0, summary: "not enough evidence" },
        repetition: { level: "low", score: 0, evidence_count: 0, summary: "none observed" },
        tool_noise: { level: "low", score: 0, evidence_count: 0, summary: "none observed" },
        continuation: { level: "medium", score: 0.5, evidence_count: 1, summary: "goal only" },
        observability: { level: "high", score: 0.9, evidence_count: 1, summary: "protected coverage" }
      },
      coverage: {
        analyzable_messages: 1,
        analyzable_ratio: 0.1,
        protected_ratio: 0.95,
        unknown_role_ratio: 0
      },
      limitations: ["protected_coverage_too_high"]
    };
    report.findings = [{
      id: "finding-1",
      type: "duplicate",
      severity: "warning",
      confidence: "high",
      code: "exact_duplicate",
      title: "Duplicate context",
      explanation: "Two messages repeat the same claim.",
      summary: "Repeated context should be reviewed.",
      impact: { message_count: 1, tokens: 42, token_ratio: 0.2 },
      suggested_action: "keep_canonical_message",
      tokens: 42,
      evidence: [{
        message_id: "m-1",
        source_line: 7,
        role: "assistant",
        code: "exact_duplicate",
        confidence: "high"
      }]
    }];
    report.review_queue = { items: [{
      message_id: "m-1",
      source_line: 7,
      role: "assistant",
      decision: "keep_protected",
      protected: true,
      tokens: 42,
      risk: "low",
      confidence: "high",
      reasons: ["duplicate_message"],
      evidence: report.findings[0]!.evidence,
      summary: "api_key=abc123456789012345 user@example.com https://user:password@example.com/private Authorization: Basic dXNlcjpwYXNz Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature <img src=x onerror=alert(1)> [click](javascript:alert(1)) | first\nsecond",
      default_action: "keep_and_review"
    }] };
    report.resume = {
      readiness: {
        score: 20,
        level: "blocked",
        missing: ["next steps"],
        signals: { current_goal: true, decisions: false, active_files: false, test_signals: false, next_steps: false }
      },
      currentGoal: {
        text: "Inspect <img src=x> [click](javascript:alert(1)) Authorization: Bearer opaque-bearer-token",
        sourceLine: 8,
        messageId: "m-2",
        role: "user",
        confidence: "high"
      },
      decisions: [],
      activeFiles: [],
      failures: [],
      testSignals: [],
      nextSteps: []
    };
    report.recommendations = [{ code: "write_report", priority: 1, summary: "Write a report." }];
    deepFreeze(report);

    const markdown = formatReportMarkdown(report);

    for (const heading of [
      "# trimctx 会话健康报告",
      "## 结论",
      "## 健康维度",
      "## 关键发现",
      "## 审查队列",
      "## Protected 但疑似陈旧",
      "## 续接状态",
      "## 限制与安全说明",
      "## 下一步"
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("发现：Duplicate context");
    expect(markdown).toContain("依据：Two messages repeat the same claim.");
    expect(markdown).toContain("影响：1 条消息，42 tokens");
    expect(markdown).toContain("行动：keep_canonical_message");
    expect(markdown).toContain("m-1");
    expect(markdown).toContain("line 7");
    expect(markdown).toContain("assistant");
    expect(markdown).toContain("[REDACTED]");
    expect(markdown).toContain("[REDACTED_EMAIL]");
    expect(markdown).toContain("\\|");
    expect(markdown).not.toContain("abc123456789012345");
    expect(markdown).not.toContain("user@example.com");
    expect(markdown).not.toContain("user:password");
    expect(markdown).not.toContain("dXNlcjpwYXNz");
    expect(markdown).not.toContain("eyJhbGciOiJIUzI1NiJ9.payload.signature");
    expect(markdown).not.toContain("opaque-bearer-token");
    expect(markdown).not.toContain("<img");
    expect(markdown).not.toContain("[click](javascript:");
    expect(markdown).toContain("&lt;img");
    expect(markdown).toContain("\\[click\\]\\(javascript:alert\\(1\\)\\)");
    expect(markdown).toContain('``trimctx report "session`danger.jsonl" -o report.md``');
    expect(markdown).toContain('``trimctx report "session`danger.jsonl" -o report.json``');
    expect(markdown).toContain("证据不足");
    expect(markdown.toLowerCase()).not.toContain("conversation is clean");
    expect(markdown).not.toContain("正文");
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
