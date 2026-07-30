import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { analyzeFile } from "../src/core/pipeline.js";
import { listSessions, parseSessionSource, resolveBoundSessionFile } from "../src/sessions/discovery.js";
import {
  analyzeFile as analyzeFileFromFacade,
  parseSessionSource as parseSessionSourceFromFacade
} from "../src/core/session.js";

const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
const previousTranscriptPath = process.env.TRIMCTX_TRANSCRIPT_PATH;
const previousSessionId = process.env.TRIMCTX_SESSION_ID;

afterEach(() => {
  restoreEnv("HOME", previousHome);
  restoreEnv("USERPROFILE", previousUserProfile);
  restoreEnv("TRIMCTX_TRANSCRIPT_PATH", previousTranscriptPath);
  restoreEnv("TRIMCTX_SESSION_ID", previousSessionId);
});

describe("pipeline and session boundaries", () => {
  test("analyzes a file through the standalone pipeline", async () => {
    const report = await analyzeFile(join(process.cwd(), "tests", "fixtures", "openai-chat.jsonl"));

    expect(report.input.source).toBe("openai-jsonl");
    expect(report.summary.total_messages).toBeGreaterThan(0);
  });

  test("validates session sources in the discovery module", () => {
    expect(parseSessionSource(undefined)).toBe("auto");
    expect(parseSessionSource("claude")).toBe("claude");
    expect(parseSessionSource("codex")).toBe("codex");
    expect(() => parseSessionSource("unknown")).toThrow("source must be one of: auto, claude, codex");
  });

  test("lists Claude and Codex sessions by modification time with lightweight metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-session-discovery-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const claudeDir = join(home, ".claude", "projects", "project-a");
    const codexDir = join(home, ".codex", "sessions", "2026", "07", "16");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    const olderFile = join(claudeDir, "older.jsonl");
    const newerFile = join(codexDir, "newer.jsonl");
    await writeFile(olderFile, "{}\n", "utf8");
    await writeFile(newerFile, "{}\n{}\n", "utf8");
    const older = new Date("2026-07-15T00:00:00.000Z");
    const newer = new Date("2026-07-16T00:00:00.000Z");
    await utimes(olderFile, older, older);
    await utimes(newerFile, newer, newer);

    const sessions = await listSessions("auto", home);

    expect(sessions).toEqual([
      expect.objectContaining({
        source: "codex",
        projectLabel: join("2026", "07", "16"),
        sessionId: "newer",
        file: newerFile,
        sizeBytes: 6
      }),
      expect.objectContaining({
        source: "claude",
        projectLabel: "project-a",
        sessionId: "older",
        file: olderFile,
        sizeBytes: 3
      })
    ]);
    expect(sessions[0]?.modifiedAt).toEqual(newer);
  });

  test("filters discovered sessions by source", async () => {
    const home = await mkdtemp(join(tmpdir(), "trimctx-session-source-"));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const claudeDir = join(home, ".claude", "projects", "project-a");
    const codexDir = join(home, ".codex", "sessions", "2026", "07", "16");
    await mkdir(claudeDir, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(claudeDir, "claude.jsonl"), "{}\n", "utf8");
    await writeFile(join(codexDir, "codex.jsonl"), "{}\n", "utf8");

    expect((await listSessions("claude", home)).map((item) => item.source)).toEqual(["claude"]);
    expect((await listSessions("codex", home)).map((item) => item.source)).toEqual(["codex"]);
  });

  test("resolves only a readable current transcript binding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-bound-session-"));
    const file = join(dir, "bound-session.jsonl");
    await writeFile(file, "{}\n", "utf8");
    process.env.TRIMCTX_TRANSCRIPT_PATH = file;
    process.env.TRIMCTX_SESSION_ID = "bound-session";

    await expect(resolveBoundSessionFile()).resolves.toBe(file);

    process.env.TRIMCTX_SESSION_ID = "another-session";
    await expect(resolveBoundSessionFile()).rejects.toThrow("session ID 不匹配");

    delete process.env.TRIMCTX_TRANSCRIPT_PATH;
    delete process.env.TRIMCTX_SESSION_ID;
    await expect(resolveBoundSessionFile()).rejects.toThrow("当前窗口尚未绑定");
  });

  test("rejects missing and non-file current transcript bindings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trimctx-invalid-bound-session-"));

    process.env.TRIMCTX_TRANSCRIPT_PATH = join(dir, "missing.jsonl");
    await expect(resolveBoundSessionFile()).rejects.toThrow("transcript 不可读");

    process.env.TRIMCTX_TRANSCRIPT_PATH = dir;
    await expect(resolveBoundSessionFile()).rejects.toThrow("transcript 不是文件");
  });

  test("keeps the legacy core/session facade exports", () => {
    expect(analyzeFileFromFacade).toBe(analyzeFile);
    expect(parseSessionSourceFromFacade).toBe(parseSessionSource);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
