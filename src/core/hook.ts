import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendFileDistinctFromInput } from "../platform/files.js";
import { formatContextState, injectContextStateSection } from "./context-state.js";
import { analyzeClaudeStopFile } from "./hook-analysis.js";
import { readHookInput } from "./hook-input.js";
import { readClaudeMd, writeClaudeMd } from "./hook-storage.js";

export interface HookResult {
  file: string;
  pressure: string;
  updated: boolean;
  message: string;
}

function projectClaudeMdPath(): string {
  return join(process.cwd(), ".claude", "CLAUDE.md");
}

export async function writeSessionEnvBinding(): Promise<{ updated: boolean; message: string }> {
  const input = await readHookInput();
  if (!input.transcript_path) {
    throw new Error("Claude SessionStart hook input transcript_path is required");
  }
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) {
    throw new Error("CLAUDE_ENV_FILE is required to persist current Claude session bindings");
  }

  const lines = [
    `export TRIMCTX_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}`,
    `export TRIMCTX_SESSION_ID=${shellQuote(input.session_id ?? "")}`
  ];

  await mkdir(dirname(envFile), { recursive: true });
  await appendFileDistinctFromInput(
    input.transcript_path,
    envFile,
    `${lines.join("\n")}\n`,
    "Claude session env file must be different from transcript"
  );
  return { updated: true, message: "updated trimctx Claude session binding" };
}

export async function runHook(options: { dryRun?: boolean } = {}): Promise<HookResult> {
  const input = await readHookInput();

  if (!input.transcript_path) {
    throw new Error("Claude hook input transcript_path is required");
  }
  const sessionFile = input.transcript_path;
  const report = await analyzeClaudeStopFile(sessionFile, input.last_assistant_message);
  const pressure = report.summary.context_pressure.pressure_level;
  const rotCount = report.summary.remove_candidates + report.summary.compress_candidates;
  const claudeMdPath = projectClaudeMdPath();
  const claudeMdSnapshot = await readClaudeMd(claudeMdPath);
  const existingContent = claudeMdSnapshot?.content;

  if (pressure === "low" && rotCount === 0) {
    if (existingContent) {
      const cleaned = injectContextStateSection(existingContent, "");
      if (cleaned !== existingContent) {
        if (!options.dryRun) {
          await writeClaudeMd(claudeMdPath, claudeMdSnapshot, cleaned);
        }
        return { file: sessionFile, pressure, updated: true, message: "已清除上下文状态（压力低）" };
      }
    }
    return { file: sessionFile, pressure, updated: false, message: "上下文压力低，无需更新" };
  }

  const stateSection = formatContextState(report);
  const content = existingContent ?? "";
  const updated = injectContextStateSection(content, stateSection);

  if (!options.dryRun) {
    await writeClaudeMd(claudeMdPath, claudeMdSnapshot, updated);
  }

  return {
    file: sessionFile,
    pressure,
    updated: true,
    message: `已更新 CLAUDE.md 上下文状态：${pressure} / ${rotCount} rot candidates`
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
