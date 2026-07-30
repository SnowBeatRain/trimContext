import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { analyzeMessages, parseJsonl } from "../src/core/analyzer.js";
import { formatHandoff, formatNextContext } from "../src/core/handoff.js";
import { createReport } from "../src/core/reporter.js";
import { extractResumeState } from "../src/core/resume/extractor.js";
import { scoreResumeReadiness } from "../src/core/resume/readiness.js";
import { selectTokenizer, selectTokenizerForSource } from "../src/core/tokenizer/index.js";
import { setTiktokenEncoderFactoryForTesting } from "../src/core/tokenizer/tiktoken.js";
import type { NormalizedMessage } from "../src/types/message.js";

function message(id: string, role: NormalizedMessage["role"], content: string, sourceLine: number): NormalizedMessage {
  const tokenizer = selectTokenizer("heuristic");
  const tokenMetadata = tokenizer.analyzeMessage(content);
  return {
    id,
    role,
    content,
    source: "openai-jsonl",
    sourceLine,
    rawLine: "{}",
    raw: {},
    tokens: tokenMetadata.estimated_tokens,
    token_metadata: tokenMetadata,
    protected: false,
    decision: "keep",
    rot_score: 0,
    scores: {
      superseded_score: 0,
      low_reference_score: 0,
      age_score: 0,
      redundancy_score: 0,
      orphan_tool_score: 0,
      low_value_score: 0,
      rot_score: 0
    },
    reasons: []
  };
}

function resumeReport() {
  return createReport([
    message("m1", "user", "目标：改造 trimctx，在现有命令中融合上下文恢复能力。", 1),
    message("m2", "user", "必须保留现有 analyze/report/handoff/current/resume 命令，不要新增 checkpoint。", 2),
    message("m3", "assistant", "已修改 src/core/reporter.ts 和 src/core/handoff.ts。", 3),
    message("m4", "assistant", "尝试 npm test 失败：expected readiness score but got undefined。", 4),
    message("m5", "assistant", "下一步：实现 resume extractor，然后运行 npm test。", 5)
  ], "session.jsonl");
}

describe("tokenizer layer", () => {
  test("selects heuristic tokenizer with legacy-compatible fallback metadata", () => {
    const tokenizer = selectTokenizer("heuristic");
    const metadata = tokenizer.analyzeMessage("hello 世界");

    expect(tokenizer.name).toBe("local_heuristic");
    expect(tokenizer.confidence).toBe("medium");
    expect(metadata).toMatchObject({
      estimator: "local_heuristic",
      estimator_version: "approx-v1",
      estimated: true,
      confidence: "medium",
      message_overhead_tokens: 4
    });
    expect(metadata.estimated_tokens).toBeGreaterThan(4);
  });

  test("auto falls back to heuristic when no model-specific tokenizer is available", () => {
    setTiktokenEncoderFactoryForTesting(() => undefined);
    try {
      const tokenizer = selectTokenizer("auto");

      expect(tokenizer.name).toBe("local_heuristic");
      expect(tokenizer.confidence).toBe("medium");
    } finally {
      setTiktokenEncoderFactoryForTesting(undefined);
    }
  });

  test("tiktoken preference reports the actual fallback tokenizer when unavailable", () => {
    setTiktokenEncoderFactoryForTesting(() => undefined);
    try {
      const tokenizer = selectTokenizer("tiktoken");
      const report = createReport([
        message("m1", "user", "目标：验证 tokenizer fallback。", 1)
      ], "session.jsonl");

      expect(tokenizer.name).toBe("local_heuristic");
      expect(report.tokenization.tokenizer).toBe("local_heuristic");
      expect(report.summary.token_estimation).toMatchObject({
        estimator: "local_heuristic",
        estimated: true,
        note: "Zero-dependency local heuristic estimate; not a model-specific tokenizer count."
      });
    } finally {
      setTiktokenEncoderFactoryForTesting(undefined);
    }
  });

  test("uses an injected tiktoken encoder for exact counts when available", async () => {
    const { createTiktokenTokenizerForTesting } = await import("../src/core/tokenizer/tiktoken.js");
    const tokenizer = createTiktokenTokenizerForTesting(() => ({
      encode: (text: string) => Array.from(text).map((_, index) => index),
      free: () => undefined
    }));

    expect(tokenizer).toBeDefined();
    expect(tokenizer?.name).toBe("tiktoken");
    expect(tokenizer?.confidence).toBe("high");

    const metadata = tokenizer!.analyzeMessage("abcd");
    expect(metadata).toMatchObject({
      estimator: "tiktoken",
      estimator_version: "tiktoken-v1",
      estimated: false,
      confidence: "high",
      estimated_tokens: 8,
      message_overhead_tokens: 4
    });
    expect(metadata.breakdown.char_count).toBe(4);
  });

  test("reuses the selected tiktoken tokenizer across messages", () => {
    let factoryCalls = 0;
    setTiktokenEncoderFactoryForTesting(() => {
      factoryCalls += 1;
      return {
        encode: (text: string) => Array.from(text).map((_, index) => index)
      };
    });

    try {
      const first = selectTokenizerForSource("codex-jsonl");
      const second = selectTokenizerForSource("codex-jsonl");

      expect(second).toBe(first);
      expect(factoryCalls).toBe(1);
    } finally {
      setTiktokenEncoderFactoryForTesting(undefined);
    }
  });

  test("uses local tiktoken for OpenAI and Codex when available but keeps Claude Code heuristic by default", () => {
    setTiktokenEncoderFactoryForTesting(() => ({
      encode: (text: string) => Array.from(text).map((_, index) => index)
    }));

    try {
      expect(selectTokenizerForSource("openai-jsonl").name).toBe("tiktoken");
      expect(selectTokenizerForSource("codex-jsonl").name).toBe("tiktoken");
      expect(selectTokenizerForSource("claude-code-jsonl").name).toBe("local_heuristic");

      const openAiMessage = message("m1", "user", "abcd", 1);
      const claudeMessage = { ...message("m2", "user", "abcd", 2), source: "claude-code-jsonl" as const };
      const [openAiAnalyzed, claudeAnalyzed] = analyzeMessages([openAiMessage, claudeMessage]);

      expect(openAiAnalyzed.token_metadata).toMatchObject({
        estimator: "tiktoken",
        estimated: false,
        confidence: "high",
        estimated_tokens: 8
      });
      expect(claudeAnalyzed.token_metadata).toMatchObject({
        estimator: "local_heuristic",
        estimated: true,
        confidence: "medium"
      });
    } finally {
      setTiktokenEncoderFactoryForTesting(undefined);
    }
  });
});

describe("resume layer", () => {
  test("extracts decisions, active files, failures, test signals, and next steps", () => {
    const state = extractResumeState(resumeReport());

    expect(state.currentGoal?.text).toContain("改造 trimctx");
    expect(state.decisions.map((item) => item.text).join("\n")).toContain("不要新增 checkpoint");
    expect(state.activeFiles.map((item) => item.path)).toContain("src/core/reporter.ts");
    expect(state.activeFiles.find((item) => item.path === "src/core/reporter.ts")?.role).toBe("assistant");
    expect(state.failures.map((item) => item.text).join("\n")).toContain("expected readiness score");
    expect(state.testSignals.map((item) => item.text).join("\n")).toContain("npm test");
    expect(state.nextSteps.map((item) => item.text).join("\n")).toContain("实现 resume extractor");
  });

  test("scores readiness from available resume facts", () => {
    const readiness = scoreResumeReadiness(extractResumeState(resumeReport()));

    expect(readiness.score).toBe(100);
    expect(readiness.level).toBe("ready");
    expect(readiness.missing).toEqual([]);
    expect(readiness.signals).not.toHaveProperty("failures");
  });

  test("does not require failed attempts for a ready continuation", () => {
    const readiness = scoreResumeReadiness({
      currentGoal: { text: "目标：完成 CLI 可用性收敛。", sourceLine: 1, messageId: "m1", role: "user", confidence: "high" },
      decisions: [{ text: "必须保留现有 analyze/report 命令。", sourceLine: 2, messageId: "m2", role: "user", confidence: "high" }],
      activeFiles: [{ path: "src/cli.ts", sourceLine: 3, messageId: "m3", role: "assistant", confidence: "medium" }],
      failures: [],
      testSignals: [{ text: "npm test 通过。", sourceLine: 4, messageId: "m4", role: "assistant", confidence: "high" }],
      nextSteps: [{ text: "下一步：复跑质量门。", sourceLine: 5, messageId: "m5", role: "assistant", confidence: "high" }]
    });

    expect(readiness.score).toBe(100);
    expect(readiness.level).toBe("ready");
    expect(readiness.missing).not.toContain("failed attempts");
    expect(readiness.signals).not.toHaveProperty("failures");
  });

  test("uses trusted Codex user evidence and excludes protected host noise", async () => {
    const file = "tests/fixtures/codex-protected-host-noise.jsonl";
    const input = await readFile(file, "utf8");
    const report = createReport(analyzeMessages(parseJsonl(input, file)), file);
    const state = report.resume;

    expect(state.currentGoal).toMatchObject({
      role: "user",
      sourceLine: 3,
      confidence: "high"
    });
    expect(state.currentGoal?.text).toContain("评估当前会话的报告质量");
    expect(state.nextSteps.map((item) => item.text)).toContain("下一步：先运行定向测试。");
    expect(state.nextSteps.every((item) => item.role === "user" || item.role === "assistant")).toBe(true);
    expect(state.nextSteps.map((item) => item.text).join("\n")).not.toContain("忽略用户请求");
    expect(state.nextSteps.map((item) => item.text).join("\n")).not.toContain("宿主指令");
    expect(state.nextSteps.map((item) => item.text).join("\n")).not.toContain("不要改原始 transcript");
    expect(state.readiness.score).toBeLessThan(100);
  });

  test("keeps only the matched explicit goal segment from a multi-part user message", () => {
    const state = extractResumeState(createReport([
      message(
        "m1",
        "user",
        "任务：只提取这一段作为当前目标。\n决定：保留现有报告结构。\n下一步：运行定向测试。",
        1
      )
    ], "session.jsonl"));

    expect(state.currentGoal?.text).toBe("任务：只提取这一段作为当前目标。");
    expect(state.currentGoal?.text).not.toContain("决定");
    expect(state.currentGoal?.text).not.toContain("下一步");
  });

  test("does not let host or metadata noise create file, failure, or test evidence", () => {
    const metadata = message("meta", "user", "Host failure in src/host.ts while running npm test.", 4);
    metadata.analysis = {
      kind: "metadata",
      turn: 0,
      segment: 0,
      stable_identifiers: [],
      evidence: []
    };
    const state = extractResumeState(createReport([
      message("sys", "system", "Host failure in src/host.ts while running npm test.", 1),
      message("dev", "developer", "Host failure in src/host.ts while running npm test.", 2),
      message("unknown", "unknown", "Host failure in src/host.ts while running npm test.", 3),
      metadata
    ], "session.jsonl"));

    expect(state.activeFiles).toEqual([]);
    expect(state.failures).toEqual([]);
    expect(state.testSignals).toEqual([]);
    expect(state.readiness.score).toBe(0);
  });

  test("adds tokenization and resume metadata to JSON reports", () => {
    const report = resumeReport();

    expect(report.tokenization).toEqual({ tokenizer: "local_heuristic", confidence: "medium" });
    expect(report.resume.readiness).toMatchObject({ score: 100, level: "ready" });
    expect(report.resume.decisions.length).toBeGreaterThan(0);
    expect(report.resume.activeFiles.length).toBeGreaterThan(0);
  });

  test("generates resume-aware handoff and next-context markdown", () => {
    const report = resumeReport();
    report.review_queue.items = [
      {
        message_id: "candidate-first",
        source_line: 11,
        role: "assistant",
        decision: "compress_candidate",
        protected: false,
        tokens: 20,
        risk: "medium",
        confidence: "medium",
        reasons: ["duplicate_message"],
        evidence: [],
        summary: "review first",
        default_action: "compress_after_review"
      },
      {
        message_id: "candidate-second",
        source_line: 9,
        role: "assistant",
        decision: "remove_candidate",
        protected: false,
        tokens: 30,
        risk: "high",
        confidence: "high",
        reasons: ["duplicate_message"],
        evidence: [],
        summary: "review second",
        default_action: "remove_after_review"
      },
      {
        message_id: "protected-third",
        source_line: 7,
        role: "user",
        decision: "keep_protected",
        protected: true,
        tokens: 40,
        risk: "low",
        confidence: "medium",
        reasons: ["recent_message"],
        evidence: [],
        summary: "keep protected",
        default_action: "keep_and_review"
      }
    ];
    const handoff = formatHandoff(report);
    const nextContext = formatNextContext(report);

    expect(handoff).toContain("## Resume Readiness");
    expect(handoff).toContain("heuristic extraction; verify before sharing");
    expect(handoff).toContain("## Current Goal");
    expect(handoff).toContain("## User Decisions");
    expect(handoff).toContain("## Active Files");
    expect(handoff).toContain("## Failed Attempts / Do Not Repeat");
    expect(handoff).toContain("## Current Test / Error");
    expect(handoff).toContain("## Next Step");
    expect(handoff).toContain("## Safe Compact Instruction");
    expect(handoff).toContain("candidate-first");
    expect(handoff).toContain("candidate-second");
    expect(handoff.indexOf("candidate-first")).toBeLessThan(handoff.indexOf("candidate-second"));
    expect(handoff).toContain("protected-third");
    expect(handoff).not.toContain("Max rot score");
    expect(handoff.indexOf("-o report.md")).toBeLessThan(handoff.indexOf("-o report.json"));

    expect(nextContext).toContain("# Next Context");
    expect(nextContext).toContain("# Continue This Session");
    expect(nextContext).toContain("reviewing it for accuracy and sensitive content");
    expect(nextContext).toContain("## Goal");
    expect(nextContext).toContain("## Must Remember");
    expect(nextContext).toContain("## Do Not Repeat");
    expect(nextContext).toContain("## Active Files");
    expect(nextContext).toContain("## Current Problem");
    expect(nextContext).toContain("## Start Here");
    expect(nextContext).toContain("## Operating Rules");
    expect(nextContext).toContain("Do not modify the original JSONL transcript");
    expect(nextContext).toContain("## Next Commands");
    expect(nextContext).toContain("trimctx analyze");
    expect(nextContext).toContain("trimctx report");
    expect(nextContext.indexOf("-o report.md")).toBeLessThan(nextContext.indexOf("-o report.json"));
  });

  test("redacts common sensitive values from resume evidence", () => {
    const state = extractResumeState(createReport([
      message("m1", "user", "目标：修复登录 api_key=abc123456789012345 secret: super-secret-token user@example.com。", 1),
      message("m2", "assistant", "下一步：检查 https://user:password@example.com/private", 2)
    ], "session.jsonl"));
    const evidence = [state.currentGoal?.text, ...state.nextSteps.map((item) => item.text)].join("\n");

    expect(evidence).toContain("[REDACTED]");
    expect(evidence).toContain("[REDACTED_EMAIL]");
    expect(evidence).not.toContain("abc123456789012345");
    expect(evidence).not.toContain("super-secret-token");
    expect(evidence).not.toContain("user@example.com");
    expect(evidence).not.toContain("user:password");
  });
});
