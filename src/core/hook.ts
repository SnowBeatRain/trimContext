import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { analyzeFile } from "./pipeline.js";
import { formatContextState, injectContextStateSection } from "./context-state.js";

interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
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

function projectClaudeMdPath(): string {
  return join(process.cwd(), ".claude", "CLAUDE.md");
}

async function readExistingClaudeMd(): Promise<string | undefined> {
  try {
    return await readFile(projectClaudeMdPath(), "utf8");
  } catch {
    return undefined;
  }
}

export async function writeSessionEnvBinding(): Promise<{ updated: boolean; message: string }> {
  const input = await readStdinJson<HookInput>();
  if (!input.transcript_path) {
    throw new Error("Claude SessionStart hook input transcript_path is required");
  }
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile) {
    throw new Error("CLAUDE_ENV_FILE is required to persist current Claude session bindings");
  }

  const lines = [
    `export TRIMCTX_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}`
  ];
  if (input.session_id) {
    lines.push(`export TRIMCTX_SESSION_ID=${shellQuote(input.session_id)}`);
  }

  await mkdir(dirname(envFile), { recursive: true });
  await appendFile(envFile, `${lines.join("\n")}\n`, "utf8");
  return { updated: true, message: "updated trimctx current Claude session binding" };
}

export async function runHook(options: { dryRun?: boolean } = {}): Promise<HookResult> {
  const input = await readStdinJson<HookInput>();

  if (!input.transcript_path) {
    throw new Error("Claude hook input transcript_path is required");
  }
  const sessionFile = input.transcript_path;
  const report = await analyzeFile(sessionFile);
  const pressure = report.summary.context_pressure.pressure_level;
  const rotCount = report.summary.remove_candidates + report.summary.compress_candidates;
  const claudeMdPath = projectClaudeMdPath();
  const existingContent = await readExistingClaudeMd();

  if (pressure === "low" && rotCount === 0) {
    if (existingContent) {
      const cleaned = injectContextStateSection(existingContent, "");
      if (cleaned !== existingContent) {
        if (!options.dryRun) {
          await writeFile(claudeMdPath, cleaned, "utf8");
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
    await mkdir(dirname(claudeMdPath), { recursive: true });
    await writeFile(claudeMdPath, updated, "utf8");
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
