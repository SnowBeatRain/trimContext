import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findLatestSession, analyzeFile } from "./session.js";
import { formatContextState, injectContextStateSection } from "./context-state.js";

interface HookInput {
  stop_hook_active?: boolean;
}

export interface HookResult {
  file: string;
  pressure: string;
  updated: boolean;
  message: string;
}

async function readStdinJson<T>(): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function findProjectClaudeMd(): Promise<string | undefined> {
  const cwd = process.cwd();
  const candidate = join(cwd, ".claude", "CLAUDE.md");
  try {
    await readFile(candidate, "utf8");
    return candidate;
  } catch {
    return undefined;
  }
}

export async function runHook(options: { dryRun?: boolean } = {}): Promise<HookResult> {
  const _input = await readStdinJson<HookInput>();

  const sessionFile = await findLatestSession("claude");
  const report = await analyzeFile(sessionFile);
  const pressure = report.summary.context_pressure.pressure_level;
  const rotCount = report.summary.remove_candidates + report.summary.compress_candidates;

  const claudeMdPath = await findProjectClaudeMd();

  if (pressure === "low" && rotCount === 0) {
    const existingPath = claudeMdPath;
    if (existingPath) {
      const content = await readFile(existingPath, "utf8");
      const cleaned = injectContextStateSection(content, "");
      if (cleaned !== content) {
        if (!options.dryRun) {
          await writeFile(existingPath, cleaned, "utf8");
        }
        return { file: sessionFile, pressure, updated: true, message: "已清除上下文状态（压力低）" };
      }
    }
    return { file: sessionFile, pressure, updated: false, message: "上下文压力低，无需更新" };
  }

  const stateSection = formatContextState(report);

  if (!claudeMdPath) {
    return {
      file: sessionFile,
      pressure,
      updated: false,
      message: `未找到 .claude/CLAUDE.md，跳过注入。状态：${pressure} / ${rotCount} rot candidates`
    };
  }

  const content = await readFile(claudeMdPath, "utf8");
  const updated = injectContextStateSection(content, stateSection);

  if (!options.dryRun) {
    await writeFile(claudeMdPath, updated, "utf8");
  }

  return {
    file: sessionFile,
    pressure,
    updated: true,
    message: `已更新 CLAUDE.md 上下文状态：${pressure} / ${rotCount} rot candidates`
  };
}
