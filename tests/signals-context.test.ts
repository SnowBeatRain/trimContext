import { describe, expect, test } from "vitest";
import {
  annotateMessageContext,
  classifyMessage,
  stableIdentifiers
} from "../src/core/signals/context.js";
import type { NormalizedMessage } from "../src/types/message.js";

function message(
  id: string,
  role: NormalizedMessage["role"],
  content: string,
  raw: unknown = {}
): NormalizedMessage {
  return {
    id,
    role,
    content,
    source: "openai-jsonl",
    sourceLine: Number(id.replace(/\D/g, "")) || 1,
    rawLine: "{}",
    raw
  };
}

describe("message analysis context", () => {
  test("keeps tool work and a compact boundary in the current turn before the next user turn", () => {
    const annotated = annotateMessageContext([
      message("m1", "user", "Update src/core/analyzer.ts for --json"),
      message("m2", "assistant", "I will inspect the analyzer."),
      {
        ...message("m3", "tool", "analyzer contents"),
        tool: { isToolResult: true, toolResultFor: "read-1" }
      },
      {
        ...message(
          "m4",
          "system",
          "[away_summary] compacted context",
          { type: "system", subtype: "away_summary" }
        ),
        source: "claude-code-jsonl"
      },
      message("m5", "user", "Now update src/core/analyzer.ts with --json")
    ]);

    expect(annotated.map((entry) => entry.analysis!.turn)).toEqual([0, 0, 0, 0, 1]);
    expect(annotated.at(-1)?.analysis?.segment).toBe(1);
    expect(annotated[3]?.analysis?.segment).toBe(1);
  });

  test("advances turns for every substantive user message, regardless of message kind", () => {
    const annotated = annotateMessageContext([
      message("m1", "user", "Parser ingestion has intermittent failures today."),
      message("m2", "user", "Fix Error: parser failed."),
      message("m3", "user", "Decision: use API_V2."),
      message("m4", "user", "Plan: inspect the adapter and run tests."),
      message("m5", "user", "ok"),
      message("m6", "user", "[mode] acceptEdits", { type: "mode" })
    ]);

    expect(annotated.map((entry) => entry.analysis!.turn)).toEqual([0, 1, 2, 3, 3, 3]);
  });

  test("treats short action commands as substantive turns while excluding acknowledgements", () => {
    const annotated = annotateMessageContext([
      message("m1", "user", "Update parser behavior."),
      message("m2", "user", "Fix it."),
      message("m3", "user", "继续处理。"),
      message("m4", "user", "Proceed."),
      message("m5", "user", "ok"),
      message("m6", "user", "yes"),
      message("m7", "user", "好的"),
      message("m8", "user", "可以"),
      message("m9", "user", "确认")
    ]);

    expect(annotated.map((entry) => entry.analysis!.turn)).toEqual([0, 1, 2, 3, 3, 3, 3, 3, 3]);
    expect(annotated.slice(1, 4).map((entry) => entry.analysis!.kind)).toEqual([
      "user_goal",
      "user_goal",
      "user_goal"
    ]);
  });

  test("uses the shared action pattern for short commands and keeps common acknowledgements in the same turn", () => {
    const acknowledgements = [
      "ok", "okay", "yes", "yep", "sure", "got it", "understood", "looks good", "sounds good",
      "thanks", "thank you", "thank you very much", "great", "perfect",
      "好的", "可以", "确认", "收到", "明白", "知道了", "谢谢", "感谢", "没问题"
    ];
    const annotated = annotateMessageContext([
      message("m1", "user", "Update parser behavior."),
      message("m2", "user", "Change it."),
      message("m3", "user", "检查。"),
      message("m4", "user", "分析。"),
      ...acknowledgements.map((content, index) => message(`ack-${index}`, "user", content))
    ]);

    expect(annotated.slice(0, 4).map((entry) => entry.analysis!.turn)).toEqual([0, 1, 2, 3]);
    expect(annotated.slice(0, 4).map((entry) => entry.analysis!.kind)).toEqual([
      "user_goal", "user_goal", "user_goal", "user_goal"
    ]);
    expect(annotated.slice(4).every((entry) => entry.analysis!.turn === 3)).toBe(true);
  });

  test("classifies roles before textual cues", () => {
    expect(classifyMessage(message("m1", "user", "Please implement the report command."))).toBe("user_goal");
    expect(classifyMessage({ ...message("m2", "tool", "goal next step"), tool: { isToolResult: true } })).toBe("tool_result");
    expect(classifyMessage(message("m3", "system", "Goal: keep all data."))).toBe("instruction");
    expect(classifyMessage(message("m4", "developer", "Next step: run tests."))).toBe("instruction");
    expect(classifyMessage({ ...message("m5", "assistant", "goal next step"), tool: { isToolUse: true } })).toBe("tool_use");
    expect(classifyMessage(message("m6", "unknown", "[mode] acceptEdits"))).toBe("metadata");
    expect(classifyMessage(message("m7", "assistant", "FAIL expected true to be false"))).toBe("test_or_error");
    expect(classifyMessage(message("m8", "assistant", "I am checking the parser now."))).toBe("progress");
  });

  test("classifies decision, plan, result, and unknown messages", () => {
    expect(classifyMessage(message("m1", "assistant", "Decision: use API_V2."))).toBe("decision");
    expect(classifyMessage(message("m2", "assistant", "Plan: inspect the adapter and run tests."))).toBe("plan");
    expect(classifyMessage(message("m3", "assistant", "Result: all tests passed."))).toBe("result");
    expect(classifyMessage(message("m4", "assistant", "The transcript is available."))).toBe("unknown");
  });

  test("extracts stable identifiers without generalizing ordinary words", () => {
    const identifiers = stableIdentifiers(
      "Update src/core/analyzer.ts using --json and API_KEY; retry E123, call /v1/reports, " +
        "then change feature_flag and release-candidate. update parser ordinary words only."
    );

    expect(identifiers).toEqual(expect.arrayContaining([
      "src/core/analyzer.ts",
      "--json",
      "api_key",
      "e123",
      "/v1/reports",
      "feature_flag",
      "release-candidate"
    ]));
    expect(identifiers).not.toContain("update");
    expect(identifiers).not.toContain("ordinary");
    expect(stableIdentifiers("--json --json API_KEY api_key")).toEqual(["--json", "api_key"]);
    expect(stableIdentifiers(Array.from({ length: 30 }, (_, index) => `--flag-${index}`).join(" "))).toHaveLength(24);
  });

  test("treats only raw events and strict prefixes as metadata", () => {
    expect(classifyMessage(message("m1", "assistant", "The metadata report is ready."))).not.toBe("metadata");
    expect(classifyMessage(message("m2", "unknown", "[file-history-snapshot] {}"))).toBe("metadata");
    expect(classifyMessage(message("m3", "assistant", "normal body", { type: "mode" }))).toBe("metadata");
  });

  test("opens segments only for source-specific compact boundaries", () => {
    const annotated = annotateMessageContext([
      message("m1", "assistant", "Before compaction."),
      {
        ...message("m2", "system", "foreign compact marker", { type: "system", subtype: "away_summary" }),
        source: "openai-jsonl"
      },
      {
        ...message("m3", "system", "[compact_boundary]", { type: "system", subtype: "compact_boundary" }),
        source: "claude-code-jsonl"
      },
      {
        ...message("m4", "unknown", "[compacted] context", { type: "compacted" }),
        source: "codex-jsonl"
      }
    ]);

    expect(annotated.map((entry) => entry.analysis!.segment)).toEqual([0, 0, 1, 2]);
  });
});
