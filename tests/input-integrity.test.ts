import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { assertPhase0InputSha256 } from "../src/core/input-integrity.js";

describe("Phase 0 input integrity", () => {
  test("leaves ordinary CLI input unchanged when no digest is expected", () => {
    expect(() => assertPhase0InputSha256(Buffer.from("ordinary input"), undefined))
      .not.toThrow();
  });

  test("accepts bytes that match the expected SHA-256", () => {
    const input = Buffer.from("expected input");
    const expected = createHash("sha256").update(input).digest("hex");

    expect(() => assertPhase0InputSha256(input, expected)).not.toThrow();
  });

  test("rejects bytes that do not match without exposing either digest", () => {
    const input = Buffer.from("private actual input");
    const expected = createHash("sha256").update("private expected input").digest("hex");
    const actual = createHash("sha256").update(input).digest("hex");

    expect(() => assertPhase0InputSha256(input, expected))
      .toThrow("Input changed during Phase 0 validation");
    try {
      assertPhase0InputSha256(input, expected);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(expected);
      expect(message).not.toContain(actual);
      expect(message).not.toContain("private actual input");
    }
  });

  test.each([
    "private-invalid-digest",
    "A".repeat(64),
    "0".repeat(63),
    "0".repeat(65)
  ])("rejects an invalid expected digest without echoing it", (expected) => {
    expect(() => assertPhase0InputSha256(Buffer.from("input"), expected))
      .toThrow("Invalid Phase 0 input SHA-256 expectation");
    try {
      assertPhase0InputSha256(Buffer.from("input"), expected);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(expected);
    }
  });
});
