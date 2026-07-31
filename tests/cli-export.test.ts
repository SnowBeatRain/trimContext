import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { parseJsonl } from "../src/core/analyzer.js";

const execFileAsync = promisify(execFile);

describe("export CLI", () => {
  test.each([
    ["Claude Code", "tests/fixtures/claude-code-realistic.jsonl", "claude-code-jsonl"],
    ["OpenAI", "tests/fixtures/openai-chat.jsonl", "openai-jsonl"],
    ["Codex", "tests/fixtures/codex-realistic.jsonl", "codex-jsonl"]
  ] as const)("exports every normalized %s message without modifying the input", async (_, file, source) => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-format-"));
    const output = join(directory, "conversation.md");
    const input = await readFile(file);
    const messages = parseJsonl(input.toString("utf8"), file);
    const before = sha256(input);

    const result = await runCli(["export", file, "-o", output]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`export: ${output}`);
    expect(result.stdout).toContain(`messages: ${messages.length}`);
    expect(result.stdout).toContain(`source: ${source}`);
    for (const message of messages) {
      expect(result.stdout).not.toContain(message.content);
    }

    const markdown = await readFile(output, "utf8");
    expect(markdown).toContain("# trimctx Conversation Transcript");
    expect(markdown).toContain(`- source_sha256: \`${before}\``);
    expect(markdown).toContain(`- source_format: \`${source}\``);
    expect(markdown.match(/^### Message \d+ - /gm)).toHaveLength(messages.length);
    for (let index = 0; index < messages.length; index += 1) {
      expect(eventSection(markdown, index + 1)).toContain(messages[index]!.content);
    }
    expect(sha256(await readFile(file))).toBe(before);
  });

  test("uses only a trusted current-window binding when file is omitted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-bound-"));
    const file = join(directory, "bound-session.jsonl");
    const output = join(directory, "bound.md");
    await writeFile(file, await readFile("tests/fixtures/openai-chat.jsonl"));

    const result = await runCli(["export", "-o", output], {
      TRIMCTX_TRANSCRIPT_PATH: file,
      TRIMCTX_SESSION_ID: "bound-session"
    });

    expect(result.code).toBe(0);
    expect(await readFile(output, "utf8")).toContain(`- source_file: \`${file}\``);
  });

  test("does not fall back to the latest local session without a binding", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-transcript-unbound-"));
    const sessions = join(home, ".claude", "projects", "project");
    const output = join(home, "conversation.md");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "latest.jsonl"), await readFile("tests/fixtures/claude-code-realistic.jsonl"));

    const result = await runCli(["export", "-o", output], {
      HOME: home,
      USERPROFILE: home,
      TRIMCTX_TRANSCRIPT_PATH: undefined,
      TRIMCTX_SESSION_ID: undefined
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("当前窗口尚未绑定 transcript");
    await expect(readFile(output, "utf8")).rejects.toThrow();
  });

  test("accepts a case-insensitive .md output extension", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-uppercase-"));
    const output = join(directory, "conversation.MD");

    const result = await runCli([
      "export",
      "tests/fixtures/openai-chat.jsonl",
      "-o",
      output
    ]);

    expect(result.code).toBe(0);
    expect(await readFile(output, "utf8")).toContain("trimctx.transcript.v1");
  });

  test("rejects a non-Markdown output without replacing an existing target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-extension-"));
    const output = join(directory, "conversation.txt");
    await writeFile(output, "existing transcript\n", "utf8");

    const result = await runCli([
      "export",
      "tests/fixtures/openai-chat.jsonl",
      "-o",
      output
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("export output must end in .md");
    expect(await readFile(output, "utf8")).toBe("existing transcript\n");
  });

  test("rejects the input file itself as output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-same-"));
    const file = join(directory, "session.md");
    const input = await readFile("tests/fixtures/openai-chat.jsonl");
    await writeFile(file, input);

    const result = await runCli(["export", file, "-o", file]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Export output must be different from input file");
    expect(await readFile(file)).toEqual(input);
  });

  test("rejects a hard-linked output without changing the input", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-hardlink-"));
    const file = join(directory, "session.jsonl");
    const output = join(directory, "conversation.md");
    const input = await readFile("tests/fixtures/openai-chat.jsonl");
    await writeFile(file, input);
    await link(file, output);

    const result = await runCli(["export", file, "-o", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Export output must be different from input file");
    expect(await readFile(file)).toEqual(input);
  });

  test("preserves an existing target when JSONL parsing fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-invalid-"));
    const file = join(directory, "invalid.jsonl");
    const output = join(directory, "conversation.md");
    await writeFile(file, "{\"role\":\"user\",\"content\":\"valid\"}\n{invalid json}\n", "utf8");
    await writeFile(output, "existing transcript\n", "utf8");

    const result = await runCli(["export", file, "-o", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain(`${file}:2:`);
    expect(await readFile(output, "utf8")).toBe("existing transcript\n");
  });

  test("preserves an existing target and names the input when the JSONL format is unsupported", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-unsupported-"));
    const file = join(directory, "unsupported.jsonl");
    const output = join(directory, "conversation.md");
    await writeFile(file, '{"kind":"unsupported"}\n', "utf8");
    await writeFile(output, "existing transcript\n", "utf8");

    const result = await runCli(["export", file, "-o", output]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unsupported JSONL format");
    expect(result.stderr).toContain(file);
    expect(await readFile(output, "utf8")).toBe("existing transcript\n");
  });

  test("produces byte-identical Markdown for the same input path and bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-transcript-deterministic-"));
    const first = join(directory, "first.md");
    const second = join(directory, "second.md");
    const file = "tests/fixtures/claude-code-realistic.jsonl";

    expect((await runCli(["export", file, "-o", first])).code).toBe(0);
    expect((await runCli(["export", file, "-o", second])).code).toBe(0);
    expect(await readFile(first)).toEqual(await readFile(second));
  });

  test("requires an output path", async () => {
    const result = await runCli(["export", "tests/fixtures/openai-chat.jsonl"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("required option '-o, --output <conversation.md>' not specified");
  });
});

function sha256(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function eventSection(markdown: string, sequence: number): string {
  const start = markdown.indexOf(`### Message ${sequence} -`);
  const next = markdown.indexOf(`\n\n### Message ${sequence + 1} -`, start);
  return markdown.slice(start, next === -1 ? undefined : next);
}

async function runCli(
  args: string[],
  overrides: Record<string, string | undefined> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/cli.ts", ...args],
      { cwd: process.cwd(), env }
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const result = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: result.code ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  }
}
