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
        context_pressure: { level: "low", score: 0.1, evidence_count: 1, summary: "150000 estimated tokens" },
        stale_context: { level: "unknown", score: 0, evidence_count: 0, summary: "42 stale-evidence tokens" },
        repetition: { level: "low", score: 0, evidence_count: 0, summary: "small | sample" },
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
    }, {
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
      summary: "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890 api_key=abc123456789012345 user@example.com https://user:password@example.com/private Authorization: Basic dXNlcjpwYXNz Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature <img src=x onerror=alert(1)> [click](javascript:alert(1)) | first\nsecond",
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
    report.recommendations = [
      { code: "write_report", priority: 1, summary: "Write a report." },
      { code: "clarify_continuation", priority: 2, summary: "machine copy must stay hidden" }
    ];
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
    expect(markdown).toContain("- 状态：未知");
    expect(markdown).toContain("- 置信度：低");
    expect(markdown).toContain("可观测证据不足，无法给出可靠的健康判断。");
    expect(markdown).toContain("| 上下文压力 | 低 | 1 | 约 150000 tokens |");
    expect(markdown).toContain("| 陈旧上下文 | 未知 | 0 | 42 tokens 命中陈旧证据 |");
    expect(markdown).toContain("发现：重复上下文证据");
    expect(markdown).toContain("依据：完全重复的消息被归为同一组，需人工确认保留项。");
    expect(markdown).toContain("影响：1 条消息，42 tokens");
    expect(markdown).toContain("行动：保留规范消息并复核重复项");
    expect(markdown).toContain("m-1");
    expect(markdown).toContain("line 7");
    expect(markdown).toContain("assistant");
    expect(markdown).toContain("| keep_protected | 是 | 低 | 高 |");
    expect(markdown).toContain("就绪度：受阻 (20/100)");
    expect(markdown).toContain("缺失项：下一步");
    expect(markdown).toContain("先生成完整 JSON 报告，再判断会话健康状态。");
    expect(markdown).toContain("继续会话前，补充缺失的下一步。");
    expect(markdown).not.toContain("先明确当前目标和下一步");
    expect(markdown).not.toContain("machine copy must stay hidden");
    expect(markdown).not.toContain("Insufficient observable evidence");
    expect(markdown).not.toContain("Duplicate context");
    expect(markdown).not.toContain("keep_canonical_message");
    expect(markdown).not.toContain("评估限制：");
    expect(markdown.match(/Protected 内容占比过高/g)).toHaveLength(1);
    expect(markdown).toContain("[REDACTED]");
    expect(markdown).toContain("[REDACTED_EMAIL]");
    expect(markdown).toContain("\\|");
    expect(markdown).not.toContain("abc123456789012345");
    expect(markdown).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD");
    expect(markdown).not.toContain("github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890");
    expect(markdown).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890ABCD");
    expect(markdown).not.toContain("11AA0abcdefghijklmnopqrstuvwxyz1234567890");
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

  test("bounds displayed finding evidence without truncating the JSON report", () => {
    const report = createReport([], "session.jsonl");
    report.findings = [{
      id: "signal:exact_duplicate",
      type: "duplicate",
      severity: "critical",
      confidence: "high",
      code: "exact_duplicate",
      title: "Duplicate context",
      explanation: "Repeated context needs review.",
      summary: "Seven duplicate relationships.",
      impact: { message_count: 7, tokens: 70, token_ratio: 1 },
      suggested_action: "keep_canonical_message",
      tokens: 70,
      evidence: Array.from({ length: 7 }, (_, index) => ({
        message_id: `m-${index + 1}`,
        source_line: index + 1,
        role: "assistant" as const,
        code: "exact_duplicate",
        confidence: "high" as const
      }))
    }];
    deepFreeze(report);

    const markdown = formatReportMarkdown(report);

    expect(markdown.match(/  - message m-\d+, line \d+, assistant:/g)).toHaveLength(5);
    expect(markdown).toContain("另有 2 条证据，请查看 JSON report/candidate_groups。");
    expect(markdown).not.toContain("message m-6");
    expect(report.findings[0]?.evidence).toHaveLength(7);
  });

  test("partitions protected review items without duplicating the JSON queue", () => {
    const report = createReport([], "session.jsonl");
    report.review_queue = { items: [{
      message_id: "candidate-open",
      source_line: 1,
      role: "assistant",
      decision: "remove_candidate",
      protected: false,
      tokens: 10,
      risk: "high",
      confidence: "high",
      reasons: ["duplicate_message"],
      evidence: [],
      summary: "unprotected summary",
      default_action: "remove_after_review"
    }, {
      message_id: "candidate-locked",
      source_line: 2,
      role: "assistant",
      decision: "keep_protected",
      protected: true,
      tokens: 20,
      risk: "low",
      confidence: "medium",
      reasons: ["contains_user_decision"],
      evidence: [],
      summary: "protected summary",
      default_action: "keep_and_review"
    }] };
    deepFreeze(report);

    const markdown = formatReportMarkdown(report);
    const reviewSection = markdown.slice(
      markdown.indexOf("## 审查队列"),
      markdown.indexOf("## Protected 但疑似陈旧")
    );
    const protectedSection = markdown.slice(
      markdown.indexOf("## Protected 但疑似陈旧"),
      markdown.indexOf("## 续接状态")
    );

    expect(reviewSection).toContain("candidate-open");
    expect(reviewSection).not.toContain("candidate-locked");
    expect(protectedSection).toContain("candidate-locked");
    expect(protectedSection).not.toContain("candidate-open");
    expect(report.review_queue.items).toHaveLength(2);
  });

  test("bounds displayed review queue rows without truncating the JSON queue", () => {
    const report = createReport([], "session.jsonl");
    report.review_queue = {
      items: Array.from({ length: 22 }, (_, index) => ({
        message_id: `candidate-${index + 1}`,
        source_line: index + 1,
        role: "assistant" as const,
        decision: "remove_candidate" as const,
        protected: false,
        tokens: 10,
        risk: "high" as const,
        confidence: "high" as const,
        reasons: ["duplicate_message" as const],
        evidence: [],
        summary: `review item ${index + 1}`,
        default_action: "remove_after_review" as const
      }))
    };
    deepFreeze(report);

    const markdown = formatReportMarkdown(report);
    const reviewSection = markdown.slice(
      markdown.indexOf("## 审查队列"),
      markdown.indexOf("## Protected 但疑似陈旧")
    );

    expect(reviewSection.match(/\| candidate-\d+ \|/g)).toHaveLength(20);
    expect(reviewSection).toContain("另有 2 条消息，请查看 JSON report/review_queue。");
    expect(reviewSection).not.toContain("candidate-21");
    expect(report.review_queue.items).toHaveLength(22);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
