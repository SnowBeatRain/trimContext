import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  isPhase0SampleOk,
  validatePhase0Sample,
  type Phase0CliRunner
} from "../scripts/phase0-run-sample.js";
import type { Phase0SamplePlan } from "../scripts/phase0-run-plan.js";

describe("phase0 sample result validation", () => {
  test("binds every CLI invocation to the initial input SHA-256", async () => {
    const samplePlan = await createSamplePlan("command-input-sha256-binding");
    const report = minimumReport(samplePlan.inputFile);
    const expectedInputSha256 = createHash("sha256")
      .update('{"role":"user","content":"hello"}\n')
      .digest("hex");
    const receivedDigests: Array<string | undefined> = [];
    const runCli = async (...callArgs: unknown[]) => {
      const args = callArgs[0] as string[];
      receivedDigests.push(callArgs[2] as string | undefined);
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout: JSON.stringify(report) };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(
      samplePlan,
      1_000,
      runCli as Phase0CliRunner
    );

    expect(receivedDigests).toEqual([
      expectedInputSha256,
      expectedInputSha256,
      expectedInputSha256
    ]);
    expect(result).toMatchObject({ input_sha256_bound: true });
    expect(isPhase0SampleOk(result)).toBe(true);
  });

  test("matches complete analyze/report semantics despite object key order", async () => {
    const samplePlan = await createSamplePlan("analyze-report-semantic-match");
    const report = minimumReport(samplePlan.inputFile);
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(reverseObjectKeys(report))
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.analyze_report).toEqual({
      status: "matched",
      analyze_semantic_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(isPhase0SampleOk(result)).toBe(true);
  });

  test("fails the sample when valid analyze/report semantics differ", async () => {
    const samplePlan = await createSamplePlan("analyze-report-semantic-mismatch");
    const privateField = "private_semantic_field";
    const privateSentinel = "private-semantic-value";
    const report = minimumReport(samplePlan.inputFile);
    const analyzeReport = {
      ...report,
      [privateField]: { nested: privateSentinel }
    };
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout: JSON.stringify(analyzeReport) };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.analyze.ok).toBe(true);
    expect(result.report.ok).toBe(true);
    expect(result.analyze_report).toEqual({
      status: "mismatch",
      analyze_semantic_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(isPhase0SampleOk(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(privateField);
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });

  test("records the SHA-256 of the exact validated report bytes", async () => {
    const samplePlan = await createSamplePlan("report-sha256");
    const reportContents = `${JSON.stringify(minimumReport(samplePlan.inputFile), null, 2)}\n`;
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, reportContents, "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.report).toMatchObject({
      ok: true,
      report_sha256: createHash("sha256").update(reportContents).digest("hex")
    });
  });

  test("records the SHA-256 of the exact validated compressed bytes", async () => {
    const samplePlan = await createSamplePlan("compressed-sha256");
    const compressedContents = '{"role":"user","content":"exact compressed bytes"}\n';
    const report = minimumReport(
      samplePlan.inputFile,
      "openai-jsonl",
      "exact compressed bytes"
    );
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(report)
        };
      }
      if (args[0] === "report") {
        await writeFile(
          samplePlan.reportFile,
          JSON.stringify(report),
          "utf8"
        );
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, compressedContents, "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toMatchObject({
      ok: true,
      output_sha256: createHash("sha256").update(compressedContents).digest("hex")
    });
  });

  test("rejects malformed compressed JSONL after a zero-exit compress process", async () => {
    const samplePlan = await createSamplePlan("compressed-invalid-jsonl");
    const privateSentinel = "private-malformed-compressed-body";
    const report = minimumReport(samplePlan.inputFile);
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout: JSON.stringify(report) };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(
          samplePlan.compressedFile,
          `{"role":"user","content":"${privateSentinel}"`,
          "utf8"
        );
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toEqual({
      ok: false,
      exit_code: 0,
      error: `Compressed artifact contains invalid JSONL: ${samplePlan.compressedFile}`,
      output_file: samplePlan.compressedFile
    });
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });

  test("rejects valid JSONL whose messages do not match report decisions", async () => {
    const samplePlan = await createSamplePlan("compressed-message-set-drift");
    const privateSentinel = "private-extra-compressed-message";
    const report = minimumReport(samplePlan.inputFile);
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout: JSON.stringify(report) };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, [
          '{"role":"user","content":"hello"}',
          JSON.stringify({ role: "assistant", content: privateSentinel })
        ].join("\n"), "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toEqual({
      ok: false,
      exit_code: 0,
      error: `Compressed artifact messages do not match report decisions: ${samplePlan.compressedFile}`,
      output_file: samplePlan.compressedFile
    });
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });

  test("rejects a report message that cannot form a comparison identity", async () => {
    const samplePlan = await createSamplePlan("compressed-reference-unavailable");
    const privateSentinel = "private-invalid-message-role";
    const report = minimumReport(samplePlan.inputFile);
    (report.messages as Array<Record<string, unknown>>)[0]!.role = privateSentinel;
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout: JSON.stringify(report) };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(report), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toEqual({
      ok: false,
      exit_code: 0,
      error: `Compressed artifact could not be validated against report decisions: ${samplePlan.compressedFile}`,
      output_file: samplePlan.compressedFile
    });
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });

  test("rejects analyze metadata from another input without exposing that path", async () => {
    const samplePlan = await createSamplePlan("analyze-input-identity");
    const privateOtherInput = `${samplePlan.inputFile}.private-other-input`;
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(privateOtherInput, "claude-code-jsonl"))
        };
      }
      if (args[0] === "report") {
        await writeFile(
          samplePlan.reportFile,
          JSON.stringify(minimumReport(samplePlan.inputFile, "codex-jsonl")),
          "utf8"
        );
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.analyze).toMatchObject({
      ok: false,
      exit_code: 0,
      error: "Analyze report input does not match the sample"
    });
    expect(result.report.ok).toBe(true);
    expect(result.source).toBe("codex-jsonl");
    expect(isPhase0SampleOk(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(privateOtherInput);
  });

  test("rejects a report artifact from another input without hashing or exposing that path", async () => {
    const samplePlan = await createSamplePlan("report-input-identity");
    const privateOtherInput = `${samplePlan.inputFile}.private-other-input`;
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile, "claude-code-jsonl"))
        };
      }
      if (args[0] === "report") {
        await writeFile(
          samplePlan.reportFile,
          JSON.stringify(minimumReport(privateOtherInput, "codex-jsonl")),
          "utf8"
        );
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.report).toMatchObject({
      ok: false,
      exit_code: 0,
      error: `Report artifact input does not match the sample: ${samplePlan.reportFile}`
    });
    expect(result.report).not.toHaveProperty("report_sha256");
    expect(result.analyze.ok).toBe(true);
    expect(result.source).toBe("claude-code-jsonl");
    expect(isPhase0SampleOk(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(privateOtherInput);
  });

  test.each([
    {
      name: "malformed JSON",
      stdout: '{"private":"private-analyze-stdout"',
      error: "Analyze command returned invalid JSON report"
    },
    {
      name: "blank output",
      stdout: "  \r\n",
      error: "Analyze command returned no JSON report"
    },
    {
      name: "non-object JSON",
      stdout: "[]",
      error: "Analyze command returned invalid JSON report"
    }
  ])("rejects $name even when the report artifact is valid", async ({ stdout, error }) => {
    const root = await mkdtemp(join(tmpdir(), "trimctx-phase0-sample-validation-"));
    const outputDir = join(root, "output");
    const samplePlan: Phase0SamplePlan = {
      inputFile: join(root, "sample.jsonl"),
      sampleId: "sample",
      reportFile: join(outputDir, "sample.report.json"),
      compressedFile: join(outputDir, "sample.trimmed.jsonl")
    };
    await mkdir(outputDir);
    await writeFile(samplePlan.inputFile, '{"role":"user","content":"hello"}\n', "utf8");

    const commands: string[] = [];
    const runCli: Phase0CliRunner = async (args) => {
      commands.push(args[0]);
      if (args[0] === "analyze") {
        return { ok: true, exit_code: 0, stdout, stderr: "" };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(minimumReport(samplePlan.inputFile)), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0, stdout: "", stderr: "" };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(commands).toEqual(["analyze", "report", "compress"]);
    expect(result.analyze).toMatchObject({ ok: false, exit_code: 0, error });
    expect(result.report.ok).toBe(true);
    expect(result.compress.ok).toBe(true);
    expect(result.input_unchanged).toBe(true);
    expect(result.source).toBe("openai-jsonl");
    expect(JSON.stringify(result)).not.toContain("private-analyze-stdout");
  });

  test.each([
    {
      name: "non-object JSON",
      artifact: "array" as const,
      error: "Report artifact contains invalid JSON"
    },
    {
      name: "a non-regular target",
      artifact: "directory" as const,
      error: "Report artifact target is not a regular file"
    }
  ])("rejects $name and uses analyze metadata", async ({ artifact, error }) => {
    const samplePlan = await createSamplePlan("report-contract");
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        if (artifact === "array") {
          await writeFile(samplePlan.reportFile, '["private-report-value"]', "utf8");
        } else {
          await mkdir(samplePlan.reportFile);
        }
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.report).toMatchObject({
      ok: false,
      exit_code: 0,
      error: `${error}: ${samplePlan.reportFile}`
    });
    expect(result.report).not.toHaveProperty("report_sha256");
    expect(result.source).toBe("openai-jsonl");
    expect(isPhase0SampleOk(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-report-value");
  });

  test("preserves a failed report process without inspecting a stale artifact", async () => {
    const samplePlan = await createSamplePlan("failed-report-process");
    await mkdir(samplePlan.reportFile);
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        return { ok: false, exit_code: 3, error: "report subprocess failed" };
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.report).toMatchObject({
      ok: false,
      exit_code: 3,
      error: "report subprocess failed"
    });
    expect(result.source).toBe("openai-jsonl");
  });

  test.each([
    {
      name: "a missing artifact",
      artifact: "missing" as const,
      error: "Compressed artifact was not created"
    },
    {
      name: "a non-regular artifact",
      artifact: "directory" as const,
      error: "Compressed artifact target is not a regular file"
    }
  ])("rejects $name after a successful compress process", async ({ artifact, error }) => {
    const samplePlan = await createSamplePlan("compress-contract");
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(minimumReport(samplePlan.inputFile)), "utf8");
      }
      if (args[0] === "compress" && artifact === "directory") {
        await mkdir(samplePlan.compressedFile);
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toMatchObject({
      ok: false,
      exit_code: 0,
      error: `${error}: ${samplePlan.compressedFile}`
    });
    expect(result.analyze.ok).toBe(true);
    expect(result.report.ok).toBe(true);
    expect(result.source).toBe("openai-jsonl");
    expect(isPhase0SampleOk(result)).toBe(false);
  });

  test("preserves a failed compress process without inspecting a stale artifact", async () => {
    const samplePlan = await createSamplePlan("failed-compress-process");
    await mkdir(samplePlan.compressedFile);
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(minimumReport(samplePlan.inputFile)), "utf8");
      }
      if (args[0] === "compress") {
        return { ok: false, exit_code: 4, error: "compress subprocess failed" };
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.compress).toMatchObject({
      ok: false,
      exit_code: 4,
      error: "compress subprocess failed"
    });
    expect(result.source).toBe("openai-jsonl");
  });

  test("rejects an analyze object with an invalid Report v2 contract", async () => {
    const samplePlan = await createSamplePlan("invalid-analyze-contract");
    const privateSentinel = "private-invalid-analyze-contract";
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify({ schema_version: "wrong", private: privateSentinel })
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify(minimumReport(samplePlan.inputFile)), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.analyze).toMatchObject({
      ok: false,
      exit_code: 0,
      error: "Analyze command returned invalid trimctx.report.v2 contract"
    });
    expect(result.report.ok).toBe(true);
    expect(result.compress.ok).toBe(true);
    expect(result.source).toBe("openai-jsonl");
    expect(result.analyze_report).toEqual({ status: "unavailable" });
    expect(result.analyze_report).not.toHaveProperty("analyze_semantic_sha256");
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });

  test("rejects a report object with an invalid Report v2 contract", async () => {
    const samplePlan = await createSamplePlan("invalid-report-contract");
    const privateSentinel = "private-invalid-report-contract";
    const runCli: Phase0CliRunner = async (args) => {
      if (args[0] === "analyze") {
        return {
          ok: true,
          exit_code: 0,
          stdout: JSON.stringify(minimumReport(samplePlan.inputFile))
        };
      }
      if (args[0] === "report") {
        await writeFile(samplePlan.reportFile, JSON.stringify({
          schema_version: "wrong",
          private: privateSentinel
        }), "utf8");
      }
      if (args[0] === "compress") {
        await writeFile(samplePlan.compressedFile, '{"role":"user","content":"hello"}\n', "utf8");
      }
      return { ok: true, exit_code: 0 };
    };

    const result = await validatePhase0Sample(samplePlan, 1_000, runCli);

    expect(result.report).toMatchObject({
      ok: false,
      exit_code: 0,
      error: `Report artifact contains invalid trimctx.report.v2 contract: ${samplePlan.reportFile}`
    });
    expect(result.analyze.ok).toBe(true);
    expect(result.compress.ok).toBe(true);
    expect(result.source).toBe("openai-jsonl");
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
  });
});

async function createSamplePlan(name: string): Promise<Phase0SamplePlan> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-phase0-${name}-`));
  const outputDir = join(root, "output");
  const samplePlan: Phase0SamplePlan = {
    inputFile: join(root, "sample.jsonl"),
    sampleId: "sample",
    reportFile: join(outputDir, "sample.report.json"),
    compressedFile: join(outputDir, "sample.trimmed.jsonl")
  };
  await mkdir(outputDir);
  await writeFile(samplePlan.inputFile, '{"role":"user","content":"hello"}\n', "utf8");
  return samplePlan;
}

function minimumReport(
  inputFile: string,
  source: "claude-code-jsonl" | "openai-jsonl" | "codex-jsonl" = "openai-jsonl",
  content = "hello"
): Record<string, unknown> {
  return {
    schema_version: "trimctx.report.v2",
    input: {
      file: inputFile,
      source
    },
    summary: {
      total_messages: 1,
      total_tokens: 1,
      remove_candidates: 0,
      compress_candidates: 0,
      protected_messages: 1,
      score_diagnostics: {
        near_remove_threshold_count: 0,
        protected_high_rot_count: 0,
        max_rot_score: 0
      }
    },
    messages: [{
      id: "message-1",
      role: "user",
      content,
      source,
      sourceLine: 1,
      tokens: 1,
      protected: true,
      rot_score: 0,
      scores: {
        superseded_score: 0,
        low_reference_score: 0,
        age_score: 0,
        redundancy_score: 0,
        orphan_tool_score: 0,
        low_value_score: 0,
        rot_score: 0
      },
      decision: "keep_protected",
      reasons: ["recent_message"],
      analysis: {
        kind: "request",
        turn: 0,
        segment: 0,
        stable_identifiers: [],
        evidence: []
      }
    }],
    remove_candidates: [],
    compress_candidates: [],
    warnings: []
  };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeys(entry)])
  );
}
