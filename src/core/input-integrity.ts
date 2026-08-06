import { createHash } from "node:crypto";

export const PHASE0_EXPECTED_INPUT_SHA256_ENV = "TRIMCTX_PHASE0_EXPECT_INPUT_SHA256";

const SHA256 = /^[a-f0-9]{64}$/;

export function assertPhase0InputSha256(
  input: Uint8Array,
  expected = process.env[PHASE0_EXPECTED_INPUT_SHA256_ENV]
): void {
  if (expected === undefined) return;
  if (!SHA256.test(expected)) {
    throw new Error("Invalid Phase 0 input SHA-256 expectation");
  }

  const actual = createHash("sha256").update(input).digest("hex");
  if (actual !== expected) {
    throw new Error("Input changed during Phase 0 validation");
  }
}
