import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("package contents", () => {
  test("includes Claude plugin and Codex skill integration files", async () => {
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
      cwd: process.cwd()
    });
    const [pack] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = pack.files.map((file) => file.path);

    expect(files).toContain("install.sh");
    expect(files).toContain("install.ps1");
    expect(files).toContain("plugins/trimctx/.claude-plugin/plugin.json");
    expect(files).toContain("plugins/trimctx/.system");
    expect(files).toContain("plugins/trimctx/commands/trimctx.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/analyze.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/resume.md");
    expect(files).toContain("plugins/trimctx/commands/trimctx/compress.md");
    expect(files).toContain("codex/skills/trimctx/SKILL.md");
  });
});
