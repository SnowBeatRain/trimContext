import { readdir, stat } from "node:fs/promises";
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
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
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
    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { file: fullPath, mtimeMs: fileStat.mtimeMs };
    }
  }
  return latest;
}

export async function findLatestSession(source: SessionSource, home = homedir()): Promise<string> {
  const latest = (await listSessions(source, home))[0];
  if (!latest) {
    throw new Error(formatNoSessionHelp(source, home));
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

export function formatNoSessionHelp(source: SessionSource = "auto", home = homedir()): string {
  const roots = sessionRoots(source, home).map(file => prettyHomePath(file, home)).join(" or ");
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

export function prettyHomePath(file: string, home = homedir()): string {
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
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
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
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
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

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
