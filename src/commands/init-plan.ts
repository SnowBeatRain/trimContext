import { join } from "node:path";

export type InitClient = "all" | "claude" | "codex";
export type InitTarget = "user" | "project";

export interface InitAsset {
  client: Exclude<InitClient, "all">;
  source: string;
  destination: string;
  label: string;
}

export function createInitAssets(
  packageRoot: string,
  client: InitClient,
  baseDir: string
): InitAsset[] {
  const assets: InitAsset[] = [];
  if (client === "all" || client === "claude") {
    assets.push({
      client: "claude",
      source: join(packageRoot, "plugins", "trimctx"),
      destination: join(baseDir, ".claude", "plugins", "trimctx"),
      label: "Claude Code plugin commands"
    });
  }
  if (client === "all" || client === "codex") {
    assets.push({
      client: "codex",
      source: join(packageRoot, "codex", "skills", "trimctx"),
      destination: join(baseDir, ".codex", "skills", "trimctx"),
      label: "Codex skill"
    });
  }
  return assets;
}

export function parseInitClient(value: string | undefined): InitClient {
  if (value === undefined || value === "all" || value === "claude" || value === "codex") {
    return value ?? "all";
  }
  throw new Error("client must be one of: all, claude, codex");
}

export function parseInitTarget(value: string | undefined): InitTarget {
  if (value === "user" || value === "project") {
    return value;
  }
  throw new Error("target must be one of: user, project");
}
