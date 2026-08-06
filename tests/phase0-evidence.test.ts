import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadPhase0ValidationEvidence } from "../scripts/phase0-evidence.js";

type Source = "claude-code-jsonl" | "openai-jsonl" | "codex-jsonl";

interface ReportArtifactFixture {
  sha256: string;
  semanticSha256?: string;
  source: Source | string;
  inputFile: string;
}

interface CompressedArtifactFixture {
  sha256: string;
  validation: {
    status: "matched" | "invalid_structure" | "message_set_mismatch" | "reference_unavailable";
    expected_messages: number;
    parsed_messages: number;
  };
}

interface ResultFixture {
  sample: string;
  source: Source;
  input_sha256_before: string;
  input_sha256_after: string;
  input_sha256_bound?: boolean;
  input_unchanged: boolean;
  analyze: { ok: boolean };
  analyze_report?: {
    status: "matched" | "mismatch" | "unavailable";
    analyze_semantic_sha256?: string;
  };
  report: { ok: boolean; report_file: string; report_sha256?: string };
  compress: { ok: boolean; output_file: string; output_sha256?: string };
  stderr?: string;
  error?: string;
}

describe("Phase 0 batch validation evidence", () => {
  test("reports missing evidence without exposing the reports directory", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-missing-secret-"));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      new Map([["sample", {
        sha256: digest("sample"),
        source: "openai-jsonl",
        inputFile: join("private", "sample.jsonl")
      }]]),
      new Map()
    );

    expect(evidence).toMatchObject({
      available: false,
      ready: false,
      passed: false,
      issues: ["missing_phase0_results"]
    });
    expect(JSON.stringify(evidence)).not.toContain(reportsDir);
  });

  test("accepts a coherent five-sample batch with complete source coverage", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-valid-secret-"));
    const results = completeResults(reportsDir);
    results[0]!.stderr = "private-stderr-detail";
    results[0]!.error = "private-error-detail";
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: true,
      passed: true,
      sample_count: 5,
      source_counts: {
        "claude-code-jsonl": 2,
        "openai-jsonl": 1,
        "codex-jsonl": 2
      },
      analyze_success_rate: 1,
      report_success_rate: 1,
      compress_success_rate: 1,
      input_sha256_bound: 5,
      input_unchanged: 5,
      expected_reports: 5,
      matched_reports: 5,
      matched_report_hashes: 5,
      expected_analyze_report_pairs: 5,
      matched_analyze_report_semantics: 5,
      expected_compressed_artifacts: 5,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 5,
      matched_compressed_message_sets: 5,
      issues: []
    });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(reportsDir);
    expect(serialized).not.toContain("private-stderr-detail");
    expect(serialized).not.toContain("private-error-detail");
  });

  test("rejects a batch-recorded analyze/report semantic mismatch", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-analyze-report-mismatch-"));
    const results = completeResults(reportsDir);
    results[0]!.analyze_report!.status = "mismatch";
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      expected_analyze_report_pairs: 5,
      matched_analyze_report_semantics: 4,
      issues: ["analyze_report_semantic_mismatch"]
    });
  });

  test("rejects current report semantics that differ from the recorded analyze digest", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-current-report-semantics-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = reportArtifacts(results);
    const privateSemanticSha256 = digest("private-current-report-semantics");
    actual.set("openai", {
      ...actual.get("openai")!,
      semanticSha256: privateSemanticSha256
    });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      expected_analyze_report_pairs: 5,
      matched_analyze_report_semantics: 4,
      issues: ["analyze_report_semantic_mismatch"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateSemanticSha256);
  });

  test("keeps older results v2 review-required when semantic evidence is absent", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-analyze-report-legacy-"));
    const results = completeResults(reportsDir);
    for (const result of results) delete result.analyze_report;
    await writeResults(reportsDir, results, { analyze_report_matched: undefined });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      expected_analyze_report_pairs: 5,
      matched_analyze_report_semantics: 0,
      issues: ["analyze_report_semantic_validation_unavailable"]
    });
  });

  test("keeps older results v2 review-required when command input binding evidence is absent", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-binding-legacy-"));
    const results = completeResults(reportsDir);
    for (const result of results) delete result.input_sha256_bound;
    await writeResults(reportsDir, results, { input_sha256_bound: undefined });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      input_sha256_bound: 0,
      issues: ["input_sha256_binding_unavailable"]
    });
  });

  test.each([
    { name: "false", value: false },
    { name: "a non-boolean", value: "private-invalid-input-binding" }
  ])("rejects $name present command input binding evidence", async ({ value }) => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-binding-invalid-"));
    const results = completeResults(reportsDir);
    (results[0] as Record<string, unknown>).input_sha256_bound = value;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
    if (typeof value === "string") {
      expect(JSON.stringify(evidence)).not.toContain(value);
    }
  });

  test("rejects an out-of-range command input binding aggregate", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-binding-invalid-aggregate-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results, { input_sha256_bound: -1 });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
  });

  test("rejects a well-formed command input binding aggregate that drifts from results", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-binding-aggregate-drift-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results, { input_sha256_bound: 4 });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      input_sha256_bound: 5
    });
    expect(evidence.issues).toContain("aggregate_mismatch");
  });

  test("rejects malformed present analyze/report semantic evidence", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-analyze-report-invalid-"));
    const results = completeResults(reportsDir);
    const privateInvalidDigest = "private-invalid-semantic-digest";
    results[0]!.analyze_report = {
      status: "matched",
      analyze_semantic_sha256: privateInvalidDigest
    };
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateInvalidDigest);
  });

  test("rejects a malformed present analyze/report aggregate count", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-analyze-report-invalid-aggregate-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results, { analyze_report_matched: -1 });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
  });

  test("excludes an explicitly unavailable failed command from semantic pairs", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-analyze-report-unavailable-"));
    const results = completeResults(reportsDir);
    results[0]!.analyze.ok = false;
    results[0]!.analyze_report = { status: "unavailable" };
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: true,
      passed: false,
      expected_analyze_report_pairs: 4,
      matched_analyze_report_semantics: 4,
      issues: ["analyze_success_rate_below_gate"]
    });
  });

  test("keeps incomplete sample and source coverage not ready", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-coverage-"));
    const results = [resultFixture(reportsDir, "claude-only", "claude-code-jsonl")];
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.issues).toEqual(expect.arrayContaining([
      "insufficient_samples",
      "insufficient_claude_samples",
      "insufficient_openai_samples",
      "insufficient_codex_samples"
    ]));
  });

  test("rejects a stale or incomplete report set", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-report-set-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = reportArtifacts(results.slice(0, 4));
    actual.set("stale-report", {
      sha256: digest("stale-report"),
      source: "openai-jsonl",
      inputFile: join("private", "stale-report.jsonl")
    });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.matched_reports).toBe(4);
    expect(evidence.issues).toContain("report_set_mismatch");
  });

  test("rejects aggregate counts that disagree with recomputed results", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-aggregate-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results, { analyze_ok: 4 });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.issues).toContain("aggregate_mismatch");
  });

  test("marks a complete batch failed when an execution rate misses its gate", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-execution-"));
    const results = completeResults(reportsDir);
    results.at(-1)!.compress.ok = false;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: true,
      passed: false,
      compress_success_rate: 0.8
    });
    expect(evidence.issues).toContain("compress_success_rate_below_gate");
  });

  test("rejects a same-name report whose SHA-256 differs from batch evidence", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-report-hash-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = reportArtifacts(results);
    actual.set("claude-a", {
      ...actual.get("claude-a")!,
      sha256: digest("replaced-claude-a"),
      source: "claude-code-jsonl",
      inputFile: results[0]!.sample
    });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 4,
      issues: ["report_hash_mismatch"]
    });
  });

  test("rejects a same-name compressed artifact whose SHA-256 differs from batch evidence", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-hash-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = compressedArtifacts(results);
    const privateReplacementHash = digest("private-replaced-compressed-content");
    actual.set("claude-a", compressedArtifact(privateReplacementHash));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      expected_compressed_artifacts: 5,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 4,
      issues: ["compressed_hash_mismatch"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateReplacementHash);
  });

  test("rejects a compressed artifact whose JSONL structure is invalid", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-structure-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = compressedArtifacts(results);
    actual.set("claude-a", compressedArtifact(
      results[0]!.compress.output_sha256!,
      "invalid_structure",
      2,
      0
    ));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 4,
      matched_compressed_message_sets: 4,
      issues: ["compressed_structure_invalid"]
    });
  });

  test("rejects a compressed normalized message multiset that differs from report decisions", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-messages-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = compressedArtifacts(results);
    actual.set("openai", compressedArtifact(
      results[2]!.compress.output_sha256!,
      "message_set_mismatch",
      3,
      4
    ));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 5,
      matched_compressed_message_sets: 4,
      issues: ["compressed_message_set_mismatch"]
    });
  });

  test("keeps semantic validation unavailable when the report reference is unusable", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-reference-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actual = compressedArtifacts(results);
    actual.set("codex-a", compressedArtifact(
      results[3]!.compress.output_sha256!,
      "reference_unavailable"
    ));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 5,
      structurally_valid_compressed_artifacts: 4,
      matched_compressed_message_sets: 4,
      issues: ["compressed_validation_unavailable"]
    });
  });

  test("rejects report sources that contradict otherwise matching batch evidence", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-report-source-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const privateInvalidSource = "private-invalid-report-source";
    const actual = new Map([...reportArtifacts(results)].map(([id, artifact]) => [
      id,
      {
        sha256: artifact.sha256,
        semanticSha256: artifact.semanticSha256,
        inputFile: artifact.inputFile,
        source: id === "openai" ? privateInvalidSource : results.find((result) =>
          basename(result.report.report_file, ".report.json") === id
        )!.source
      }
    ]));

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 5,
      matched_report_sources: 4,
      source_counts: {
        "claude-code-jsonl": 2,
        "openai-jsonl": 0,
        "codex-jsonl": 2
      }
    });
    expect(evidence.issues).toEqual(expect.arrayContaining([
      "report_source_mismatch",
      "insufficient_openai_samples"
    ]));
    expect(JSON.stringify(evidence)).not.toContain(privateInvalidSource);
  });

  test("rejects a report input that contradicts otherwise matching batch evidence", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-report-input-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const privateOtherInput = join("private", "private-other-input.jsonl");
    const actual = reportArtifacts(results);
    actual.set("openai", {
      ...actual.get("openai")!,
      inputFile: privateOtherInput
    });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      matched_reports: 5,
      matched_report_hashes: 5,
      matched_report_sources: 5,
      matched_report_inputs: 4
    });
    expect(evidence.issues).toContain("report_input_mismatch");
    expect(JSON.stringify(evidence)).not.toContain(privateOtherInput);
  });

  test("rejects input hash evidence that contradicts the unchanged flag", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-hash-"));
    const results = completeResults(reportsDir);
    const privateAfterHash = digest("private-different-after-hash");
    results[0]!.input_sha256_after = privateAfterHash;
    results[0]!.input_unchanged = true;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateAfterHash);
  });

  test("preserves a coherent input mutation as a failed execution gate", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-input-mutation-"));
    const results = completeResults(reportsDir);
    results[0]!.input_sha256_after = digest("different-after-hash");
    results[0]!.input_unchanged = false;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: true,
      passed: false,
      input_unchanged: 4,
      issues: ["input_mutation_detected"]
    });
  });

  test("rejects a stale or incomplete compressed artifact set", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-compressed-set-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results);
    const actualCompressed = compressedArtifacts(results);
    const privateMissingId = "openai";
    const privateStaleId = "private-stale-compressed";
    actualCompressed.delete(privateMissingId);
    actualCompressed.set(
      privateStaleId,
      compressedArtifact(digest("private-stale-compressed-content"))
    );

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actualCompressed
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      expected_compressed_artifacts: 5,
      matched_compressed_artifacts: 4
    });
    expect(evidence.issues).toContain("compressed_set_mismatch");
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain(JSON.stringify(privateMissingId));
    expect(serialized).not.toContain(JSON.stringify(privateStaleId));
  });

  test("rejects failed_samples that contradict successful results", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-failed-samples-"));
    const results = completeResults(reportsDir);
    const privateFailedSample = join("private", "private-failed-sample.jsonl");
    await writeResults(reportsDir, results, { failed_samples: [privateFailedSample] });

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false
    });
    expect(evidence.issues).toContain("aggregate_mismatch");
    expect(JSON.stringify(evidence)).not.toContain(privateFailedSample);
  });

  test("rejects duplicate sample paths", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-duplicate-sample-"));
    const results = completeResults(reportsDir);
    results[1]!.sample = results[0]!.sample;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.issues).toContain("duplicate_samples");
  });

  test("rejects duplicate successful compressed artifact ids", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-duplicate-compressed-"));
    const results = completeResults(reportsDir);
    results[1]!.compress.output_file = join("private-output", "claude-a.trimmed.jsonl");
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence.ready).toBe(false);
    expect(evidence.passed).toBe(false);
    expect(evidence.issues).toContain("duplicate_compressed_ids");
  });

  test("requires a fresh batch when legacy evidence has no report integrity data", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-legacy-evidence-"));
    const results = completeResults(reportsDir);
    await writeResults(reportsDir, results, {}, "trimctx.phase0.results.v1");

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      issues: ["report_integrity_unavailable"]
    });
  });

  test("rejects v2 evidence when a successful report has no SHA-256", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-missing-report-hash-"));
    const results = completeResults(reportsDir);
    const actual = reportArtifacts(results);
    delete results[0]!.report.report_sha256;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
  });

  test("rejects an invalid report SHA-256 without exposing its value", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-invalid-report-hash-"));
    const results = completeResults(reportsDir);
    const actual = reportArtifacts(results);
    const privateInvalidHash = "private-invalid-report-hash";
    results[0]!.report.report_sha256 = privateInvalidHash;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      actual,
      compressedArtifacts(results)
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateInvalidHash);
  });

  test("keeps older v2 evidence review-required when a successful compress digest is absent", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-missing-compressed-hash-"));
    const results = completeResults(reportsDir);
    const actual = compressedArtifacts(results);
    delete results[0]!.compress.output_sha256;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      matched_compressed_artifacts: 5,
      matched_compressed_hashes: 4,
      issues: ["compressed_integrity_unavailable"]
    });
  });

  test("rejects an invalid compressed SHA-256 without exposing its value", async () => {
    const reportsDir = await mkdtemp(join(tmpdir(), "trimctx-phase0-invalid-compressed-hash-"));
    const results = completeResults(reportsDir);
    const actual = compressedArtifacts(results);
    const privateInvalidHash = "private-invalid-compressed-hash";
    results[0]!.compress.output_sha256 = privateInvalidHash;
    await writeResults(reportsDir, results);

    const evidence = await loadPhase0ValidationEvidence(
      reportsDir,
      reportArtifacts(results),
      actual
    );

    expect(evidence).toMatchObject({
      available: true,
      ready: false,
      passed: false,
      issues: ["invalid_phase0_results"]
    });
    expect(JSON.stringify(evidence)).not.toContain(privateInvalidHash);
  });
});

function completeResults(reportsDir: string): ResultFixture[] {
  return [
    resultFixture(reportsDir, "claude-a", "claude-code-jsonl"),
    resultFixture(reportsDir, "claude-b", "claude-code-jsonl"),
    resultFixture(reportsDir, "openai", "openai-jsonl"),
    resultFixture(reportsDir, "codex-a", "codex-jsonl"),
    resultFixture(reportsDir, "codex-b", "codex-jsonl")
  ];
}

function resultFixture(reportsDir: string, sample: string, source: Source): ResultFixture {
  return {
    sample: join("private", `${sample}.jsonl`),
    source,
    input_sha256_before: digest(`${sample}-input`),
    input_sha256_after: digest(`${sample}-input`),
    input_sha256_bound: true,
    input_unchanged: true,
    analyze: { ok: true },
    analyze_report: {
      status: "matched",
      analyze_semantic_sha256: digest(`${sample}-semantic`)
    },
    report: {
      ok: true,
      report_file: join(reportsDir, `${sample}.report.json`),
      report_sha256: digest(sample)
    },
    compress: {
      ok: true,
      output_file: join(reportsDir, `${sample}.trimmed.jsonl`),
      output_sha256: digest(`${sample}-compressed`)
    }
  };
}

function reportArtifacts(results: ResultFixture[]): Map<string, ReportArtifactFixture> {
  return new Map(results.flatMap((result) => result.report.report_sha256
    ? [[basename(result.report.report_file, ".report.json"), {
      sha256: result.report.report_sha256,
      semanticSha256: digest(`${basename(result.report.report_file, ".report.json")}-semantic`),
      source: result.source,
      inputFile: result.sample
    }] as const]
    : []));
}

function compressedArtifacts(results: ResultFixture[]): Map<string, CompressedArtifactFixture> {
  return new Map(results.flatMap((result) => result.compress.ok && result.compress.output_sha256
    ? [[
      basename(result.compress.output_file, ".trimmed.jsonl"),
      compressedArtifact(result.compress.output_sha256)
    ] as const]
    : []));
}

function compressedArtifact(
  sha256: string,
  status: CompressedArtifactFixture["validation"]["status"] = "matched",
  expectedMessages = 1,
  parsedMessages = 1
): CompressedArtifactFixture {
  return {
    sha256,
    validation: {
      status,
      expected_messages: expectedMessages,
      parsed_messages: parsedMessages
    }
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeResults(
  reportsDir: string,
  results: ResultFixture[],
  aggregateOverrides: Partial<{
    analyze_ok: number;
    analyze_report_matched: number | undefined;
    input_sha256_bound: number | undefined;
    report_ok: number;
    compress_ok: number;
    input_unchanged: number;
    failed_samples: string[];
  }> = {},
  schemaVersion = "trimctx.phase0.results.v2"
): Promise<void> {
  const aggregate = {
    analyze_ok: results.filter((result) => result.analyze.ok).length,
    analyze_report_matched: results.filter((result) => result.analyze_report?.status === "matched").length,
    input_sha256_bound: results.filter((result) => result.input_sha256_bound === true).length,
    report_ok: results.filter((result) => result.report.ok).length,
    compress_ok: results.filter((result) => result.compress.ok).length,
    input_unchanged: results.filter((result) => result.input_unchanged).length,
    failed_samples: results.filter((result) =>
      !result.input_unchanged
      || !result.analyze.ok
      || !result.report.ok
      || !result.compress.ok
      || (result.analyze_report !== undefined && result.analyze_report.status !== "matched")
    ).map((result) => result.sample),
    ...aggregateOverrides
  };
  await writeFile(join(reportsDir, "phase0-results.json"), JSON.stringify({
    schema_version: schemaVersion,
    generated_at: "2026-08-06T00:00:00.000Z",
    input_dir: "C:\\private\\phase0-secret",
    output_dir: reportsDir,
    sample_count: results.length,
    aggregate,
    results
  }), "utf8");
}
