import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { findLatestSession, formatNoSessionHelp, type SessionSource } from "./catalog.js";

export interface SessionResolutionOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function hasCurrentSessionBinding(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TRIMCTX_TRANSCRIPT_PATH?.trim());
}

export async function resolveBoundSessionFile(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const envFile = env.TRIMCTX_TRANSCRIPT_PATH?.trim();
  if (!envFile) {
    throw new Error(formatNoCurrentBindingHelp());
  }

  let fileStat;
  try {
    await access(envFile, fsConstants.R_OK);
    fileStat = await stat(envFile);
  } catch {
    throw new Error(`当前窗口绑定的 transcript 不可读：${envFile}\n\n${formatCurrentBindingRepairHelp()}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`当前窗口绑定的 transcript 不是文件：${envFile}\n\n${formatCurrentBindingRepairHelp()}`);
  }

  const sessionId = env.TRIMCTX_SESSION_ID?.trim();
  const transcriptId = basename(envFile, extname(envFile));
  if (sessionId && transcriptId !== sessionId && !transcriptId.includes(sessionId)) {
    throw new Error([
      `当前窗口绑定的 session ID 不匹配：${sessionId}`,
      `transcript 文件名：${basename(envFile)}`,
      "",
      formatCurrentBindingRepairHelp()
    ].join("\n"));
  }
  return envFile;
}

export async function resolveCurrentSessionFile(
  source: SessionSource = "auto",
  options: SessionResolutionOptions = {}
): Promise<string> {
  const env = options.env ?? process.env;
  const envFile = env.TRIMCTX_TRANSCRIPT_PATH?.trim();
  if (envFile) {
    try {
      await access(envFile, fsConstants.R_OK);
      return envFile;
    } catch {
      throw new Error(`current transcript is not readable: ${envFile}\n\n${formatNoSessionHelp(source, options.home)}`);
    }
  }

  return findLatestSession(source, options.home);
}

export function formatNoCurrentBindingHelp(): string {
  return [
    "当前窗口尚未绑定 transcript。",
    "",
    "请运行 trimctx init --with-hooks 并重启 AI 客户端，",
    "或显式分析最近会话：trimctx analyze --latest"
  ].join("\n");
}

function formatCurrentBindingRepairHelp(): string {
  return [
    "请重新运行 trimctx init --with-hooks 并重启 AI 客户端，",
    "或显式指定文件/最近会话：trimctx analyze <file> / trimctx analyze --latest"
  ].join("\n");
}
