interface HookInput {
  last_assistant_message?: string;
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

export const MAX_HOOK_INPUT_BYTES = 1024 * 1024;

interface HookInputSource extends AsyncIterable<string | Uint8Array> {
  destroy?: () => void;
}

export async function readHookInput(
  input: HookInputSource = process.stdin
): Promise<HookInput> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_HOOK_INPUT_BYTES) {
      input.destroy?.();
      throw new Error(`Claude hook input exceeds ${MAX_HOOK_INPUT_BYTES} bytes`);
    }
    chunks.push(bytes);
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
