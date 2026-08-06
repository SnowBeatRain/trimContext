interface HookInput {
  last_assistant_message?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return parseHookInput(Buffer.concat(chunks).toString("utf8"));
}

export function parseHookInput(raw: string): HookInput {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error("Claude hook input must be valid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("Claude hook input must be an object");
  }

  return {
    transcript_path: optionalString(parsed, "transcript_path"),
    session_id: optionalString(parsed, "session_id"),
    stop_hook_active: optionalBoolean(parsed, "stop_hook_active"),
    last_assistant_message: optionalString(parsed, "last_assistant_message")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Claude hook input ${field} must be a string`);
  }
  return value;
}

function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Claude hook input ${field} must be a boolean`);
  }
  return value;
}
