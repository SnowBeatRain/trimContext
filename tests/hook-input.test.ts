import { describe, expect, test } from "vitest";
import { parseHookInput } from "../src/core/hook-input.js";

describe("hook input boundary", () => {
  test("keeps validated known fields and ignores unknown fields", () => {
    expect(parseHookInput("   ")).toEqual({});
    expect(parseHookInput(JSON.stringify({
      transcript_path: "session.jsonl",
      session_id: "",
      stop_hook_active: false,
      last_assistant_message: "Final assistant reply",
      future_field: "preserved by Claude, ignored by trimctx"
    }))).toEqual({
      transcript_path: "session.jsonl",
      session_id: "",
      stop_hook_active: false,
      last_assistant_message: "Final assistant reply"
    });
  });

  test.each([
    { raw: "null", error: "Claude hook input must be an object" },
    { raw: "[]", error: "Claude hook input must be an object" },
    {
      raw: JSON.stringify({ transcript_path: 123 }),
      error: "Claude hook input transcript_path must be a string"
    },
    {
      raw: JSON.stringify({ session_id: null }),
      error: "Claude hook input session_id must be a string"
    },
    {
      raw: JSON.stringify({ stop_hook_active: "false" }),
      error: "Claude hook input stop_hook_active must be a boolean"
    },
    {
      raw: JSON.stringify({ last_assistant_message: null }),
      error: "Claude hook input last_assistant_message must be a string"
    }
  ])("rejects an invalid known shape: $error", ({ raw, error }) => {
    expect(() => parseHookInput(raw)).toThrow(error);
  });
});
