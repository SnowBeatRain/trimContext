import { afterEach, describe, expect, test } from "vitest";
import {
  parseAnalysisOptions,
  resolveInputFile
} from "../src/commands/shared/analysis-options.js";

const previousTranscriptPath = process.env.TRIMCTX_TRANSCRIPT_PATH;

afterEach(() => {
  if (previousTranscriptPath === undefined) {
    delete process.env.TRIMCTX_TRANSCRIPT_PATH;
  } else {
    process.env.TRIMCTX_TRANSCRIPT_PATH = previousTranscriptPath;
  }
});

describe("CLI analysis options", () => {
  test("parses valid optional thresholds", () => {
    expect(parseAnalysisOptions({
      recentWindow: "12",
      removeThreshold: "0.85",
      compressThreshold: "0.65"
    })).toEqual({
      recentWindow: 12,
      removeThreshold: 0.85,
      compressThreshold: 0.65
    });
  });

  test.each([
    [{ recentWindow: "1.5" }, "recent-window must be an integer"],
    [{ recentWindow: "-1" }, "recent-window must be a non-negative integer"],
    [{ removeThreshold: "nope" }, "remove-threshold must be a number"],
    [{ compressThreshold: "1.1" }, "compress-threshold must be between 0 and 1"]
  ])("rejects invalid options", (options, message) => {
    expect(() => parseAnalysisOptions(options)).toThrow(message);
  });

  test("prefers an explicit input and otherwise uses the current transcript binding", () => {
    process.env.TRIMCTX_TRANSCRIPT_PATH = "bound-session.jsonl";
    expect(resolveInputFile("explicit.jsonl")).toBe("explicit.jsonl");
    expect(resolveInputFile(undefined)).toBe("bound-session.jsonl");

    delete process.env.TRIMCTX_TRANSCRIPT_PATH;
    expect(() => resolveInputFile(undefined)).toThrow(
      "file argument is required unless TRIMCTX_TRANSCRIPT_PATH is set by the current AI client session"
    );
  });
});
