import { describe, expect, test } from "vitest";
import { analyzeMessages } from "../src/core/analyzer.js";
import { scoreMessages } from "../src/core/scorer.js";
import { normalizedToolTarget } from "../src/core/signals/duplicates.js";
import type { NormalizedMessage } from "../src/types/message.js";

function message(id: string, role: NormalizedMessage["role"], content: string): NormalizedMessage {
  return { id, role, content, source: "openai-jsonl", sourceLine: Number(id.replace(/\D/g, "")) || 1, rawLine: "{}", raw: {} };
}

function evidenceFor(messages: NormalizedMessage[], id: string) {
  return messages.find((entry) => entry.id === id)?.analysis?.evidence ?? [];
}

describe("structured signal evidence", () => {
  test("groups distant normalized duplicates in one segment and keeps the newest canonical", () => {
    const analyzed = analyzeMessages([
      message("m1", "assistant", "Build completed at 2026-07-23T10:20:30Z"),
      message("m2", "assistant", "unrelated progress"),
      message("m3", "assistant", "[assistant] Build completed at 2026-07-24T11:20:30Z"),
      message("m4", "user", "Please build the release package"),
      message("m5", "user", "Please build the debug package")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "exact_duplicate", confidence: "high", related_message_id: "m3" })
    ]));
    expect(evidenceFor(analyzed, "m3").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(analyzed, "m4").some((entry) => /duplicate/.test(entry.code))).toBe(false);
  });

  test("emits supersession only for a same-segment correction with a stable identifier", () => {
    const analyzed = analyzeMessages([
      message("m1", "user", "Use API_V2 for billing reconciliation."),
      message("m2", "assistant", "Acknowledged."),
      message("m3", "user", "Correction: instead use API_V2 through the new gateway."),
      message("m4", "system", "Correction: instead use API_V2.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "superseded", confidence: "high", related_message_id: "m3" })
    ]));
    expect(evidenceFor(analyzed, "m4").some((entry) => entry.code === "superseded")).toBe(false);
  });

  test("does not orphan paired results and marks an unreferenced replaced tool interaction obsolete", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "read-1", toolName: "Read" } },
      { ...message("m2", "tool", "old output ".repeat(300)), tool: { isToolResult: true, toolResultFor: "read-1", toolName: "Read" } },
      { ...message("m3", "assistant", "[tool_use Read] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "read-2", toolName: "Read" } },
      { ...message("m4", "tool", "fresh output"), tool: { isToolResult: true, toolResultFor: "read-2", toolName: "Read" } },
      { ...message("m5", "tool", "unmatched output"), tool: { isToolResult: true, toolResultFor: "missing" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "orphan_tool_result")).toBe(false);
    expect(evidenceFor(analyzed, "m2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "obsolete_tool_output" })]));
    expect(evidenceFor(analyzed, "m5")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "orphan_tool_result" })]));
  });

  test("does not obsolete a failed tool result that later natural language explains", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Search] {\"query\":\"API_KEY\"}"), tool: { isToolUse: true, toolUseId: "search-1", toolName: "Search" } },
      { ...message("m2", "tool", "Error: permission denied"), tool: { isToolResult: true, toolResultFor: "search-1", toolName: "Search" } },
      { ...message("m3", "assistant", "[tool_use Search] {\"query\":\"API_KEY\"}"), tool: { isToolUse: true, toolUseId: "search-2", toolName: "Search" } },
      { ...message("m4", "tool", "successful result"), tool: { isToolResult: true, toolResultFor: "search-2", toolName: "Search" } },
      message("m5", "assistant", "search-1 failed because permission was denied.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
    expect(analyzed.find((entry) => entry.id === "m2")).toMatchObject({ protected: true, decision: "keep_protected" });
  });

  test("recognizes only strict metadata forms and records support evidence deterministically", () => {
    const analyzed = analyzeMessages([
      message("m1", "unknown", "[file-history-snapshot] {\"id\":1}"),
      message("m2", "user", "The file-history-snapshot wording belongs in this request."),
      message("m3", "user", "Use API_KEY in the migration."),
      message("m4", "assistant", "API_KEY migration is complete."),
      message("m5", "user", "Continue API_KEY migration now.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "low_value_metadata", confidence: "high" })
    ]));
    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "low_value_metadata")).toBe(false);
    expect(evidenceFor(analyzed, "m3")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "old_message", confidence: "low" })
    ]));
    expect(evidenceFor(analyzed, "m3").some((entry) => entry.code === "low_reference")).toBe(false);
    expect(evidenceFor(analyzed, "m3")).toEqual([...evidenceFor(analyzed, "m3")].sort((a, b) => a.source_line - b.source_line || a.code.localeCompare(b.code)));
  });

  test("recognizes raw file-history events but never treats a compact marker as low-value metadata", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "unknown", "event payload"), raw: { type: "file-history-snapshot" } },
      { ...message("m2", "unknown", "[compacted] preserved boundary"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m3", "unknown", "attachment summary"), raw: { type: "attachment" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "low_value_metadata", confidence: "high" })
    ]));
    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "low_value_metadata")).toBe(false);
    expect(evidenceFor(analyzed, "m3").some((entry) => entry.code === "low_value_metadata")).toBe(false);
  });

  test("adds low_reference only when an old message has no later stable identifier reference", () => {
    const analyzed = analyzeMessages([
      message("m1", "user", "Use API_KEY for the initial migration."),
      message("m2", "assistant", "I will do that."),
      message("m3", "user", "Start a separate documentation task.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "low_reference", confidence: "low" })
    ]));
    expect(evidenceFor(analyzed, "m1").find((entry) => entry.code === "low_reference")?.related_message_id).toBeUndefined();
  });

  test("does not replace tool work across a compact boundary", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read before] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "before", toolName: "Read" } },
      { ...message("m2", "tool", "old output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "before", toolName: "Read" } },
      { ...message("m3", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m4", "assistant", "[tool_use Read after] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "after", toolName: "Read" } },
      { ...message("m5", "tool", "fresh output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "after", toolName: "Read" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });

  test("does not conflate Search queries or Bash commands with different structured targets", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Search first] {\"query\":\"release notes\"}"), tool: { isToolUse: true, toolUseId: "search-1", toolName: "Search" } },
      { ...message("m2", "tool", "old search"), tool: { isToolResult: true, toolResultFor: "search-1", toolName: "Search" } },
      { ...message("m3", "assistant", "[tool_use Search second] {\"query\":\"security advisory\"}"), tool: { isToolUse: true, toolUseId: "search-2", toolName: "Search" } },
      { ...message("m4", "tool", "new search"), tool: { isToolResult: true, toolResultFor: "search-2", toolName: "Search" } },
      { ...message("m5", "assistant", "[tool_use Bash third] {\"command\":\"npm test\"}"), tool: { isToolUse: true, toolUseId: "bash-1", toolName: "Bash" } },
      { ...message("m6", "tool", "old bash"), tool: { isToolResult: true, toolResultFor: "bash-1", toolName: "Bash" } },
      { ...message("m7", "assistant", "[tool_use Bash fourth] {\"command\":\"npm run build\"}"), tool: { isToolUse: true, toolUseId: "bash-2", toolName: "Bash" } },
      { ...message("m8", "tool", "new bash"), tool: { isToolResult: true, toolResultFor: "bash-2", toolName: "Bash" } }
    ], { recentWindow: 0 });

    expect(normalizedToolTarget(analyzed[0]!)).toBe("search:query=release notes");
    expect(normalizedToolTarget(analyzed[2]!)).toBe("search:query=security advisory");
    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
    expect(evidenceFor(analyzed, "m5").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });

  test("uses exact duplicate fingerprints across wrappers and avoids similar user goals without shared identifiers", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read call-one] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "call-one", toolName: "Read" } },
      { ...message("m2", "assistant", "[tool_use Read call-two] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "call-two", toolName: "Read" } },
      message("m3", "user", "Write a detailed deployment template for staging environment-one with rollout checks."),
      message("m4", "user", "Write a detailed deployment template for production environment-two with rollback checks.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "exact_duplicate", related_message_id: "m2" })]));
    expect(evidenceFor(analyzed, "m3").some((entry) => entry.code === "similar_duplicate")).toBe(false);
  });

  test("records exact evidence strengths without confidence multipliers and gates only on confidence", () => {
    const scored = scoreMessages([
      { ...message("m1", "unknown", "metadata"), analysis: { kind: "metadata", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "low_value_metadata", confidence: "high", message_id: "m1", source_line: 1, role: "unknown", details: { strength: 0.9 } }] } },
      { ...message("m2", "tool", "obsolete"), analysis: { kind: "tool_result", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "obsolete_tool_output", confidence: "medium", message_id: "m2", source_line: 2, role: "tool", details: { strength: 0.72 } }] } },
      { ...message("m3", "assistant", "similar"), analysis: { kind: "result", turn: 0, segment: 0, stable_identifiers: [], evidence: [{ code: "similar_duplicate", confidence: "medium", message_id: "m3", source_line: 3, role: "assistant", details: { strength: 0.65 } }] } }
    ], { removeThreshold: 0.8, compressThreshold: 0.6 });

    expect(scored.map((entry) => entry.scores?.rot_score)).toEqual([0.9, 0.72, 0.65]);
    expect(scored.map((entry) => entry.decision)).toEqual(["remove_candidate", "compress_candidate", "compress_candidate"]);
  });

  test("requires large attachment payloads and emits their declared strength", () => {
    const analyzed = analyzeMessages([
      message("m1", "unknown", "[attachment] {\"type\":\"skill_listing\",\"text\":\"small\"}"),
      message("m2", "unknown", `[attachment] {\"type\":\"skill_listing\",\"text\":\"${"large payload ".repeat(150)}\"}`)
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "low_value_metadata")).toBe(false);
    expect(evidenceFor(analyzed, "m2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "low_value_metadata", confidence: "medium", details: expect.objectContaining({ strength: 0.65 }) })]));
  });

  test("finds similar ordinary assistant text without a tool target", () => {
    const analyzed = analyzeMessages([
      message("m1", "assistant", "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron sigma tau approval"),
      message("m2", "assistant", "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron sigma tau review")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "similar_duplicate", confidence: "medium" })]));
  });

  test("treats tool references after compaction as unrelated but honors references in the same segment", () => {
    const postCompact = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read old] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "old", toolName: "Read" } },
      { ...message("m2", "tool", "old output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "old", toolName: "Read" } },
      { ...message("m3", "assistant", "[tool_use Read new] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "new", toolName: "Read" } },
      { ...message("m4", "tool", "new output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "new", toolName: "Read" } },
      { ...message("m5", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m6", "assistant", "The old result was discussed after compact."), source: "codex-jsonl" }
    ], { recentWindow: 0 });
    const sameSegment = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read old] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "old", toolName: "Read" } },
      { ...message("m2", "tool", "old output"), tool: { isToolResult: true, toolResultFor: "old", toolName: "Read" } },
      { ...message("m3", "assistant", "[tool_use Read new] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "new", toolName: "Read" } },
      { ...message("m4", "tool", "new output"), tool: { isToolResult: true, toolResultFor: "new", toolName: "Read" } },
      message("m5", "assistant", "The old result remains relevant.")
    ], { recentWindow: 0 });

    expect(evidenceFor(postCompact, "m2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "obsolete_tool_output" })]));
    expect(evidenceFor(sameSegment, "m2").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });

  test("chooses the newest exact duplicate unless an external later narrative references a member", () => {
    const duplicates = analyzeMessages([
      message("m1", "assistant", "Read src/app.ts and report the current parser behavior."),
      message("m2", "assistant", "Read src/app.ts and report the current parser behavior.")
    ], { recentWindow: 0 });
    const externallyReferenced = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read call-one] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "call-one", toolName: "Read" } },
      { ...message("m2", "assistant", "[tool_use Read call-two] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "call-two", toolName: "Read" } },
      message("m3", "assistant", "The call-one result is still the relevant parser evidence.")
    ], { recentWindow: 0 });

    expect(evidenceFor(duplicates, "m1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "exact_duplicate", related_message_id: "m2" })]));
    expect(evidenceFor(duplicates, "m2").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(externallyReferenced, "m1").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(externallyReferenced, "m2")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "exact_duplicate", related_message_id: "m1" })]));
  });

  test("requires a replacement tool result after its call in the same segment", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read old] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "old", toolName: "Read" } },
      { ...message("m2", "tool", "old output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "old", toolName: "Read" } },
      { ...message("m3", "assistant", "[tool_use Read new] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "new", toolName: "Read" } },
      { ...message("m4", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m5", "tool", "new output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "new", toolName: "Read" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });

  test("does not mark statement-style user messages similar without a shared stable identifier", () => {
    const analyzed = analyzeMessages([
      message("m1", "user", "This release statement describes alpha beta gamma delta epsilon zeta eta theta iota kappa lambda environment-one approval notes."),
      message("m2", "user", "This release statement describes alpha beta gamma delta epsilon zeta eta theta iota kappa lambda environment-two approval notes.")
    ], { recentWindow: 0 });

    expect(analyzed[0]?.analysis?.kind).toBe("unknown");
    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "similar_duplicate")).toBe(false);
  });

  test("ignores compact-after references when selecting an exact duplicate canonical", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read call-one] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "call-one", toolName: "Read" } },
      { ...message("m2", "assistant", "[tool_use Read call-two] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "call-two", toolName: "Read" } },
      { ...message("m3", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m4", "assistant", "The call-one result was mentioned after compact."), source: "codex-jsonl" }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "exact_duplicate", related_message_id: "m2" })]));
    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "exact_duplicate")).toBe(false);
  });

  test("scopes exact duplicates by role and resolved tool target", () => {
    const analyzed = analyzeMessages([
      message("m1", "user", "Read succeeded and the report is ready."),
      message("m2", "assistant", "Read succeeded and the report is ready."),
      { ...message("m3", "assistant", "[tool_use Read a] {\"file_path\":\"src/a.ts\"}"), tool: { isToolUse: true, toolUseId: "read-a", toolName: "Read" } },
      { ...message("m4", "tool", "[tool_result read-a] Read succeeded"), tool: { isToolResult: true, toolResultFor: "read-a" } },
      { ...message("m5", "assistant", "[tool_use Read b] {\"file_path\":\"src/b.ts\"}"), tool: { isToolUse: true, toolUseId: "read-b", toolName: "Read" } },
      { ...message("m6", "tool", "[tool_result read-b] Read succeeded"), tool: { isToolResult: true, toolResultFor: "read-b" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m1").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(analyzed, "m4").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(evidenceFor(analyzed, "m6").some((entry) => entry.code === "exact_duplicate")).toBe(false);
    expect(analyzed[3]?.decision).not.toBe("remove_candidate");
    expect(analyzed[5]?.decision).not.toBe("remove_candidate");
  });

  test("keeps a semantically explained permission failure even without its opaque tool id", () => {
    const analyzed = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read opaque-call-123] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "opaque-call-123", toolName: "Read" } },
      { ...message("m2", "tool", "Error: permission denied for service-account"), tool: { isToolResult: true, toolResultFor: "opaque-call-123" } },
      { ...message("m3", "assistant", "[tool_use Read fresh-call] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "fresh-call", toolName: "Read" } },
      { ...message("m4", "tool", "fresh output"), tool: { isToolResult: true, toolResultFor: "fresh-call" } },
      message("m5", "assistant", "The service account has a permission denial, so cached credentials are required.")
    ], { recentWindow: 0 });

    expect(evidenceFor(analyzed, "m2").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });

  test("requires a paired old result in the same segment before marking obsolete output", () => {
    const noOldResult = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read missing] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "missing", toolName: "Read" } },
      { ...message("m2", "assistant", "[tool_use Read fresh] {\"file_path\":\"src/app.ts\"}"), tool: { isToolUse: true, toolUseId: "fresh", toolName: "Read" } },
      { ...message("m3", "tool", "fresh output"), tool: { isToolResult: true, toolResultFor: "fresh" } }
    ], { recentWindow: 0 });
    const delayedOldResult = analyzeMessages([
      { ...message("m1", "assistant", "[tool_use Read old] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "old", toolName: "Read" } },
      { ...message("m2", "assistant", "[tool_use Read fresh] {\"file_path\":\"src/app.ts\"}"), source: "codex-jsonl", tool: { isToolUse: true, toolUseId: "fresh", toolName: "Read" } },
      { ...message("m3", "tool", "fresh output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "fresh" } },
      { ...message("m4", "unknown", "compacted"), source: "codex-jsonl", raw: { type: "compacted" } },
      { ...message("m5", "tool", "delayed old output"), source: "codex-jsonl", tool: { isToolResult: true, toolResultFor: "old" } }
    ], { recentWindow: 0 });

    expect(evidenceFor(noOldResult, "m1").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
    expect(evidenceFor(delayedOldResult, "m5").some((entry) => entry.code === "obsolete_tool_output")).toBe(false);
  });
});
