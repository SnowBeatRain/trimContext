import { createInterface } from "node:readline/promises";
import type { SessionCandidate } from "./discovery.js";

export interface SessionPickerAdapter {
  write(text: string): void;
  ask(prompt: string): Promise<string>;
}

export function isInteractiveTerminal(): boolean {
  return process.env.TRIMCTX_FORCE_INTERACTIVE === "1" || Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export function formatSessionCandidate(candidate: SessionCandidate, now = new Date()): string {
  const source = candidate.source === "claude" ? "Claude" : "Codex";
  return `${source}  ${candidate.projectLabel}  ${formatRelativeTime(candidate.modifiedAt, now)}  ${formatBytes(candidate.sizeBytes)}  ${candidate.sessionId}`;
}

export async function selectSession(
  candidates: SessionCandidate[],
  adapter?: SessionPickerAdapter
): Promise<SessionCandidate> {
  if (candidates.length === 0) {
    throw new Error([
      "没有找到可选择的本地 Claude/Codex 会话。",
      "",
      "请显式运行：trimctx analyze <file>",
      "或安装/修复当前窗口 hooks：trimctx init --with-hooks"
    ].join("\n"));
  }

  const readline = adapter ? undefined : createInterface({ input: process.stdin, output: process.stderr });
  const io: SessionPickerAdapter = adapter ?? {
    write: (text) => process.stderr.write(text),
    ask: (prompt) => readline!.question(prompt)
  };

  try {
    io.write("选择要分析的本地会话：\n\n");
    candidates.forEach((candidate, index) => {
      io.write(`  ${index + 1}. ${formatSessionCandidate(candidate)}\n`);
    });
    io.write("\n");
    const answer = (await io.ask("选择会话编号 [1]：")).trim();
    const selectedNumber = answer === "" ? 1 : Number(answer);
    if (!Number.isInteger(selectedNumber)) {
      throw new Error("请输入会话编号");
    }
    if (selectedNumber < 1 || selectedNumber > candidates.length) {
      throw new Error(`请选择 1 到 ${candidates.length} 之间的编号`);
    }
    const selected = candidates[selectedNumber - 1]!;
    io.write("\n只会分析所选 transcript，不会恢复或切换 AI 客户端窗口。\n\n");
    return selected;
  } finally {
    readline?.close();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(modifiedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - modifiedAt.getTime()) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
