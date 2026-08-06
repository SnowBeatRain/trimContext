import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { validatePhase0CompressedArtifact } from "../scripts/phase0-compressed-validation.js";
import { compressFile } from "../src/core/compressor.js";

type Source = "claude-code-jsonl" | "openai-jsonl" | "codex-jsonl";
type Decision = "keep" | "keep_protected" | "compress_candidate" | "remove_candidate";

interface ReportMessageFixture {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "unknown";
  content: string;
  source: Source;
  decision: Decision;
  timestamp?: string;
  sessionId?: string;
}

describe("Phase 0 compressed semantic validation", () => {
  test.each([
    ["Claude Code", "claude-code-realistic.jsonl"],
    ["OpenAI", "openai-chat.jsonl"],
    ["Codex", "codex-realistic.jsonl"]
  ])("accepts a compressed %s fixture through its source adapter", async (_name, fixture) => {
    const input = resolve("tests", "fixtures", fixture);
    const dir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-validation-"));
    const output = join(dir, "session.trimmed.jsonl");
    const result = await compressFile(input, output, { recentWindow: 0 });
    const compressed = await readFile(output, "utf8");

    const validation = validatePhase0CompressedArtifact(
      compressed,
      output,
      result.report.input.source,
      result.report.messages
    );

    expect(validation).toEqual({
      status: "matched",
      expected_messages: result.report.messages.length - result.report.remove_candidates.length,
      parsed_messages: result.report.messages.length - result.report.remove_candidates.length
    });
  });

  test("matches OpenAI batches after indexes shift and counts duplicate identities", () => {
    const source = "openai-jsonl";
    const reportMessages = [
      message(source, "assistant", "same duplicate", "remove_candidate"),
      message(source, "assistant", "same duplicate", "keep"),
      message(source, "user", "kept user message", "keep_protected")
    ];
    const compressed = JSON.stringify({
      messages: [
        { role: "assistant", content: "same duplicate" },
        { role: "user", content: "kept user message" }
      ]
    });

    expect(validatePhase0CompressedArtifact(
      compressed,
      "private-openai.trimmed.jsonl",
      source,
      reportMessages
    )).toEqual({
      status: "matched",
      expected_messages: 2,
      parsed_messages: 2
    });
  });

  test("permits valid Codex runtime rows that the adapter intentionally ignores", () => {
    const source = "codex-jsonl";
    const timestamp = "2026-08-06T00:00:00.000Z";
    const compressed = [
      JSON.stringify({ timestamp, type: "turn_context", payload: { turn_id: "private-turn" } }),
      JSON.stringify({
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "kept Codex message" }]
        }
      })
    ].join("\n");

    expect(validatePhase0CompressedArtifact(
      compressed,
      "private-codex.trimmed.jsonl",
      source,
      [message(source, "user", "kept Codex message", "keep", { timestamp })]
    )).toEqual({
      status: "matched",
      expected_messages: 1,
      parsed_messages: 1
    });
  });

  test("accepts an empty artifact only when the retained report multiset is empty", () => {
    const source = "openai-jsonl";

    expect(validatePhase0CompressedArtifact(
      "\r\n",
      "private-empty.trimmed.jsonl",
      source,
      [message(source, "assistant", "removed", "remove_candidate")]
    )).toEqual({
      status: "matched",
      expected_messages: 0,
      parsed_messages: 0
    });
  });

  test("classifies malformed JSONL without exposing parser details or content", () => {
    const privateSentinel = "private-malformed-compressed-sentinel";
    const validation = validatePhase0CompressedArtifact(
      `{"role":"user","content":"${privateSentinel}"`,
      "private-malformed.trimmed.jsonl",
      "openai-jsonl",
      []
    );

    expect(validation).toEqual({
      status: "invalid_structure",
      expected_messages: 0,
      parsed_messages: 0
    });
    expect(JSON.stringify(validation)).not.toContain(privateSentinel);
    expect(JSON.stringify(validation)).not.toContain("private-malformed.trimmed.jsonl");
  });

  test.each([
    {
      name: "adds a recognized message",
      report: [] as ReportMessageFixture[],
      compressed: '{"role":"user","content":"private-extra-message"}',
      expected: 0,
      parsed: 1
    },
    {
      name: "drops a retained message",
      report: [message("openai-jsonl", "user", "private-missing-message", "keep")],
      compressed: "",
      expected: 1,
      parsed: 0
    },
    {
      name: "keeps a remove candidate",
      report: [message("openai-jsonl", "assistant", "private-removal-message", "remove_candidate")],
      compressed: '{"role":"assistant","content":"private-removal-message"}',
      expected: 0,
      parsed: 1
    },
    {
      name: "rewrites retained content",
      report: [message("openai-jsonl", "assistant", "private-original-message", "compress_candidate")],
      compressed: '{"role":"assistant","content":"private-rewritten-message"}',
      expected: 1,
      parsed: 1
    }
  ])("detects valid-JSON message-set drift when it $name", ({ report, compressed, expected, parsed }) => {
    const validation = validatePhase0CompressedArtifact(
      compressed,
      "private-drift.trimmed.jsonl",
      "openai-jsonl",
      report
    );

    expect(validation).toEqual({
      status: "message_set_mismatch",
      expected_messages: expected,
      parsed_messages: parsed
    });
    expect(JSON.stringify(validation)).not.toContain("private-");
  });

  test("classifies an unusable report identity without exposing its value", () => {
    const privateSentinel = "private-invalid-report-content";
    const validation = validatePhase0CompressedArtifact(
      '{"role":"user","content":"kept"}',
      "private-reference.trimmed.jsonl",
      "openai-jsonl",
      [{
        role: "user",
        content: privateSentinel,
        source: "openai-jsonl",
        decision: "unknown-private-decision"
      }]
    );

    expect(validation).toEqual({
      status: "reference_unavailable",
      expected_messages: 0,
      parsed_messages: 0
    });
    expect(JSON.stringify(validation)).not.toContain(privateSentinel);
  });
});

function message(
  source: Source,
  role: ReportMessageFixture["role"],
  content: string,
  decision: Decision,
  optional: Pick<ReportMessageFixture, "timestamp" | "sessionId"> = {}
): ReportMessageFixture {
  return { source, role, content, decision, ...optional };
}
