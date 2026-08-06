import { createHash } from "node:crypto";

export function createPhase0ReportSemanticSha256(value: unknown): string | undefined {
  try {
    const canonical = canonicalJson(value, new Set<object>());
    return canonical === undefined
      ? undefined
      : createHash("sha256").update(canonical, "utf8").digest("hex");
  } catch {
    return undefined;
  }
}

function canonicalJson(value: unknown, active: Set<object>): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : undefined;
  }
  if (typeof value !== "object") return undefined;

  if (active.has(value)) return undefined;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (const item of value) {
        const canonical = canonicalJson(item, active);
        if (canonical === undefined) return undefined;
        items.push(canonical);
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalJson((value as Record<string, unknown>)[key], active);
      if (canonical === undefined) return undefined;
      entries.push(`${JSON.stringify(key)}:${canonical}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    active.delete(value);
  }
}
