import { describe, expect, test } from "vitest";
import { parseJsonl } from "../src/core/analyzer.js";


describe("parseJsonl diagnostics", () => {
  test("reports invalid JSONL line numbers", () => {
    const input = [
      '{"role":"user","content":"ok"}',
      '{"role":"assistant","content":',
      '{"role":"assistant","content":"later"}'
    ].join("\n");

    expect(() => parseJsonl(input, "broken.jsonl")).toThrow(
      "Invalid JSONL at broken.jsonl:2"
    );
  });
});
