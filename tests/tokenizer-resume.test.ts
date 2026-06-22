import { describe, expect, test } from "vitest";
import { formatHandoff, formatNextContext } from "../src/core/handoff.js";
import { createReport } from "../src/core/reporter.js";
import { extractResumeState } from "../src/core/resume/extractor.js";
import { scoreResumeReadiness } from "../src/core/resume/readiness.js";
import { selectTokenizer } from "../src/core/tokenizer/index.js";
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
    const tokenizer = selectTokenizer("auto");

    expect(["local_heuristic", "tiktoken"]).toContain(tokenizer.name);
    expect(["medium", "high"]).toContain(tokenizer.confidence);
  });
});

describe("resume layer", () => {
  test("extracts decisions, active files, failures, test signals, and next steps", () => {
    const state = extractResumeState(resumeReport());

    expect(state.currentGoal?.text).toContain("改造 trimctx");
    expect(state.decisions.map((item) => item.text).join("\n")).toContain("不要新增 checkpoint");
    expect(state.activeFiles.map((item) => item.path)).toContain("src/core/reporter.ts");
    expect(state.failures.map((item) => item.text).join("\n")).toContain("expected readiness score");
    expect(state.testSignals.map((item) => item.text).join("\n")).toContain("npm test");
    expect(state.nextSteps.map((item) => item.text).join("\n")).toContain("实现 resume extractor");
  });

  test("scores readiness from available resume facts", () => {
    const readiness = scoreResumeReadiness(extractResumeState(resumeReport()));

    expect(readiness.score).toBe(100);
    expect(readiness.level).toBe("ready");
    expect(readiness.missing).toEqual([]);
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

    expect(nextContext).toContain("# Next Context");
    expect(nextContext).toContain("# Continue This Session");
    expect(nextContext).toContain("reviewing it for accuracy and sensitive content");
    expect(nextContext).toContain("## Goal");
    expect(nextContext).toContain("## Must Remember");
    expect(nextContext).toContain("## Do Not Repeat");
    expect(nextContext).toContain("## Active Files");
    expect(nextContext).toContain("## Current Problem");
    expect(nextContext).toContain("## Start Here");
  });

  test("redacts common sensitive values from resume evidence", () => {
    const state = extractResumeState(createReport([
      message("m1", "user", "目标：修复登录。api_key=abc123456789012345 secret: super-secret-token user@example.com", 1),
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
