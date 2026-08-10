import { describe, expect, test } from "vitest";
import { redactSensitiveText } from "../src/core/redaction.js";

describe("shared sensitive text redaction", () => {
  test("redacts supported token and credential forms without exposing their values", () => {
    const values = [
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD",
      "github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890",
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
      "glpat-abcdefghijklmnopqrstuvwxyz",
      "xoxb-abcdefghijklmnopqrstuvwxyz",
      "Authorization: Bearer opaque-bearer-token",
      "Authorization: Basic dXNlcjpwYXNz",
      "https://user:password@example.com/private",
      "owner@example.com",
      "api_key=private-api-value",
      "password: private-password-value"
    ];

    const redacted = redactSensitiveText(values.join(" "));

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    for (const secret of [
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCD",
      "github_pat_11AA0abcdefghijklmnopqrstuvwxyz1234567890",
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
      "glpat-abcdefghijklmnopqrstuvwxyz",
      "xoxb-abcdefghijklmnopqrstuvwxyz",
      "opaque-bearer-token",
      "dXNlcjpwYXNz",
      "user:password",
      "owner@example.com",
      "private-api-value",
      "private-password-value"
    ]) {
      expect(redacted).not.toContain(secret);
    }
  });

  test("leaves ordinary text unchanged", () => {
    expect(redactSensitiveText("ordinary project status")).toBe("ordinary project status");
  });
});
