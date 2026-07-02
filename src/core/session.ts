import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { analyzeMessages, parseJsonl } from "./analyzer.js";
import { createReport } from "./reporter.js";
import type { AnalysisOptions } from "./options.js";
import type { AnalysisReport } from "../types/report.js";

export type SessionSource = "auto" | "claude" | "codex";

export function sessionRoots(source: SessionSource): string[] {
  const roots: Record<SessionSource, string[]> = {
    auto: [join(homedir(), ".claude", "projects"), join(homedir(), ".codex", "sessions")],
    claude: [join(homedir(), ".claude", "projects")],
    codex: [join(homedir(), ".codex", "sessions")]
  };
  return roots[source];
}

export async function findLatestJsonlUnder(root: string): Promise<{ file: string; mtimeMs: number } | undefined> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let latest: { file: string; mtimeMs: number } | undefined;
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findLatestJsonlUnder(fullPath);
      if (nested && (!latest || nested.mtimeMs > latest.mtimeMs)) {
        latest = nested;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const fileStat = await stat(fullPath);
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { file: fullPath, mtimeMs: fileStat.mtimeMs };
    }
  }
  return latest;
}

export async function findLatestSession(source: SessionSource): Promise<string> {
  const roots = sessionRoots(source);
  let latestFile = "";
  let latestMtime = 0;

  for (const root of roots) {
    const candidate = await findLatestJsonlUnder(root);
    if (candidate && candidate.mtimeMs > latestMtime) {
      latestFile = candidate.file;
      latestMtime = candidate.mtimeMs;
    }
  }

  if (!latestFile) {
    throw new Error(`no ${source} session files found under ${roots.map(prettyHomePath).join(" or ")}`);
  }
  return latestFile;
}


export async function resolveCurrentSessionFile(source: SessionSource = "auto"): Promise<string> {
  const envFile = process.env.TRIMCTX_TRANSCRIPT_PATH?.trim();
  if (envFile) {
    try {
      await access(envFile, fsConstants.R_OK);
      return envFile;
    } catch {
      throw new Error(`current transcript is not readable: ${envFile}\n\n${formatNoSessionHelp(source)}`);
    }
  }

  try {
    return await findLatestSession(source);
  } catch {
    throw new Error(formatNoSessionHelp(source));
  }
}

export function formatNoSessionHelp(source: SessionSource = "auto"): string {
  const roots = sessionRoots(source).map(prettyHomePath).join(" or ");
  return [
    "没找到可分析的 Claude/Codex 会话。",
    "",
    `已检查：${roots}`,
    "",
    "你可以：",
    "1. 在 Claude Code 里重启窗口后运行 /trimctx",
    "2. 或显式指定文件：trimctx analyze path/to/session.jsonl",
    "3. 或安装/刷新客户端资产：trimctx init"
  ].join("\n");
}

export function prettyHomePath(file: string): string {
  const home = homedir();
  if (file === home) return "~";
  if (file.startsWith(`${home}/`)) return `~/${file.slice(home.length + 1)}`;
  if (file.startsWith(`${home}\\`)) return `~\\${file.slice(home.length + 1)}`;
  return file;
}

export function parseSessionSource(value: string | undefined): SessionSource {
  if (value === undefined || value === "auto" || value === "claude" || value === "codex") {
    return value ?? "auto";
  }
  throw new Error("source must be one of: auto, claude, codex");
}

export async function analyzeFile(file: string, options: AnalysisOptions = {}): Promise<AnalysisReport> {
  const input = await readFile(file, "utf8");
  return createReport(analyzeMessages(parseJsonl(input, file), options), file);
}
