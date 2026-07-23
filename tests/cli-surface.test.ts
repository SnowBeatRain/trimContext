import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("public CLI surface", () => {
  test("shows only the five public subcommands", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    for (const command of ["init", "analyze", "report", "new-chat", "compress"]) {
      expect(result.stdout).toMatch(new RegExp(`^  ${command}\\b`, "m"));
    }
    for (const command of ["current", "handoff", "install-hooks", "hook"]) {
      expect(result.stdout).not.toMatch(new RegExp(`^  ${command}\\b`, "m"));
    }
  });

  test.each(["current", "handoff", "install-hooks"])("removes the %s command", async command => {
    const result = await runCli([command]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown command");
  });

  test.each([
    ["current", ["--help"]],
    ["current", ["--json"]],
    ["handoff", ["--help"]],
    ["handoff", ["legacy.jsonl"]],
    ["install-hooks", ["--help"]],
    ["install-hooks", ["--dir", "legacy-project"]]
  ] as const)("rejects removed command %s before parsing %j", async (command, legacyArgs) => {
    const result = await runCli([command, ...legacyArgs]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown command");
    expect(result.stderr).not.toContain("unknown option");
    expect(result.stdout).not.toContain("Usage: trimctx");
  });

  test.each(["--recent-window", "--remove-threshold", "--compress-threshold"])(
    "removes the public analyze option %s",
    async flag => {
      const result = await runCli([
        "analyze",
        "tests/fixtures/claude-code-realistic.jsonl",
        flag,
        "0"
      ]);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("unknown option");
    }
  );

  test("keeps only the uid package output option on new-chat", async () => {
    const result = await runCli(["new-chat", "--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--out <directory>");
    expect(result.stdout).not.toContain("--output");
    expect(result.stdout).not.toContain("--next-context");
    expect(result.stdout).not.toContain("--out-dir");
    expect(result.stdout).not.toContain("--recent-window");
    expect(result.stdout).not.toContain("--remove-threshold");
    expect(result.stdout).not.toContain("--compress-threshold");
  });
});

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--import", "tsx", "src/cli.ts", ...args],
      { cwd: process.cwd(), env: process.env }
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
