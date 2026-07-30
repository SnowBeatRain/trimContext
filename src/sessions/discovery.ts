import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";

export type SessionSource = "auto" | "claude" | "codex";
export type ConcreteSessionSource = Exclude<SessionSource, "auto">;

export interface SessionCandidate {
  source: ConcreteSessionSource;
  projectLabel: string;
  modifiedAt: Date;
  mtimeMs: number;
  sizeBytes: number;
  sessionId: string;
  file: string;
}

export function sessionRoots(source: SessionSource, home = homedir()): string[] {
  const roots: Record<SessionSource, string[]> = {
    auto: [join(home, ".claude", "projects"), join(home, ".codex", "sessions")],
    claude: [join(home, ".claude", "projects")],
    codex: [join(home, ".codex", "sessions")]
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
  const latest = (await listSessions(source))[0];
  if (!latest) {
    throw new Error(formatNoSessionHelp(source));
  }
  return latest.file;
}

export async function listSessions(source: SessionSource = "auto", home = homedir()): Promise<SessionCandidate[]> {
  const sessions: SessionCandidate[] = [];
  for (const sourceRoot of rootsWithSources(source, home)) {
    sessions.push(...await listJsonlUnder(sourceRoot.root, sourceRoot.source, sourceRoot.root));
  }
  return sessions.sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file));
}

export function hasCurrentSessionBinding(): boolean {
  return Boolean(process.env.TRIMCTX_TRANSCRIPT_PATH?.trim());
}

export async function resolveBoundSessionFile(): Promise<string> {
  const envFile = process.env.TRIMCTX_TRANSCRIPT_PATH?.trim();
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

  const sessionId = process.env.TRIMCTX_SESSION_ID?.trim();
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

export function formatNoCurrentBindingHelp(): string {
  return [
    "当前窗口尚未绑定 transcript。",
    "",
    "请运行 trimctx init --with-hooks 并重启 AI 客户端，",
    "或显式分析最近会话：trimctx analyze --latest"
  ].join("\n");
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
    "2. 或显式指定文件：trimctx analyze <file>",
    "3. 或安装/修复当前窗口 hooks：trimctx init --with-hooks"
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

function rootsWithSources(source: SessionSource, home: string): Array<{ source: ConcreteSessionSource; root: string }> {
  const roots = {
    claude: join(home, ".claude", "projects"),
    codex: join(home, ".codex", "sessions")
  } satisfies Record<ConcreteSessionSource, string>;
  if (source === "auto") {
    return [
      { source: "claude", root: roots.claude },
      { source: "codex", root: roots.codex }
    ];
  }
  return [{ source, root: roots[source] }];
}

async function listJsonlUnder(
  directory: string,
  source: ConcreteSessionSource,
  root: string
): Promise<SessionCandidate[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: SessionCandidate[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      sessions.push(...await listJsonlUnder(fullPath, source, root));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    try {
      const fileStat = await stat(fullPath);
      sessions.push({
        source,
        projectLabel: projectLabelFor(source, root, fullPath),
        modifiedAt: fileStat.mtime,
        mtimeMs: fileStat.mtimeMs,
        sizeBytes: fileStat.size,
        sessionId: basename(entry.name, extname(entry.name)),
        file: fullPath
      });
    } catch {
      // A session may disappear while client processes rotate files; skip it.
    }
  }
  return sessions;
}

function projectLabelFor(source: ConcreteSessionSource, root: string, file: string): string {
  const parent = relative(root, dirname(file));
  if (!parent) return source === "claude" ? "unknown-project" : "sessions";
  if (source === "claude") return parent.split(sep)[0] ?? parent;
  return parent;
}

function formatCurrentBindingRepairHelp(): string {
  return [
    "请重新运行 trimctx init --with-hooks 并重启 AI 客户端，",
    "或显式指定文件/最近会话：trimctx analyze <file> / trimctx analyze --latest"
  ].join("\n");
}
