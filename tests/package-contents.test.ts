import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const unsafeInstallPipePatterns = [
  /curl\s+[^\n|]*\|\s*(bash|sh)/i,
  /\birm\s+[^\n|]*\|\s*iex\b/i,
  /\biwr\s+[^\n|]*\|\s*iex\b/i
];

async function listPackedFiles(): Promise<string[]> {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const { stdout } = await execFileAsync(npmBin, ["pack", "--dry-run", "--json"], {
    cwd: process.cwd(),
    shell: process.platform === "win32"
  });
  const [pack] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;

  return pack.files.map((file) => file.path);
}

describe("package contents", () => {
  test("includes Claude plugin and Codex skill integration files", async () => {
    const files = await listPackedFiles();

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

  test("does not publish download-and-execute install pipe examples", async () => {
    const files = await listPackedFiles();
    const publicTextFiles = files.filter((file) => {
      const extension = path.extname(file).toLowerCase();
      return (
        [".md", ".txt", ".sh", ".ps1"].includes(extension) ||
        file === "plugins/trimctx/.system"
      );
    });

    const unsafeMatches: string[] = [];
    for (const file of publicTextFiles) {
      const content = await readFile(path.join(process.cwd(), file), "utf8");
      for (const pattern of unsafeInstallPipePatterns) {
        if (pattern.test(content)) {
          unsafeMatches.push(file);
          break;
        }
      }
    }

    expect(unsafeMatches).toEqual([]);
  });
});
