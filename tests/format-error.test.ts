import { describe, expect, test } from "vitest";
import { formatCliError } from "../src/cli/format-error.js";

describe("CLI error formatting", () => {
  test("preserves the existing single-error message", () => {
    expect(formatCliError(new Error("command failed"))).toBe("command failed");
    expect(formatCliError("command failed")).toBe("command failed");
  });

  test("recursively exposes ordered aggregate leaf causes without inspecting attached data", () => {
    const privateArtifactBody = "private-artifact-body";
    const cleanupError = Object.assign(new Error("stage cleanup failed"), {
      artifactBody: privateArtifactBody
    });
    const error = new AggregateError([
      new Error("commit failed"),
      new AggregateError([
        new Error("restore failed"),
        cleanupError
      ], "nested restore failure")
    ], "Failed to write or clean up artifacts");

    const formatted = formatCliError(error);

    expect(formatted).toBe([
      "Failed to write or clean up artifacts",
      "Cause 1: commit failed",
      "Cause 2: restore failed",
      "Cause 3: stage cleanup failed"
    ].join("\n"));
    expect(formatted).not.toContain("nested restore failure");
    expect(formatted).not.toContain(privateArtifactBody);
  });
});
