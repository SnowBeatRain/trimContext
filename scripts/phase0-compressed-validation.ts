import { createHash } from "node:crypto";
import { parseClaudeCodeJsonl } from "../src/adapters/claude-code-jsonl.js";
import { parseCodexJsonl } from "../src/adapters/codex-jsonl.js";
import { parseOpenAiJsonl } from "../src/adapters/openai-jsonl.js";
import type {
  Decision,
  MessageRole,
  MessageSource,
  NormalizedMessage
} from "../src/types/message.js";

export type Phase0CompressedValidationStatus =
  | "matched"
  | "invalid_structure"
  | "message_set_mismatch"
  | "reference_unavailable";

export interface Phase0CompressedValidation {
  status: Phase0CompressedValidationStatus;
  expected_messages: number;
  parsed_messages: number;
}

interface ComparableMessage {
  source: MessageSource;
  role: MessageRole;
  content: string;
  timestamp?: string;
  sessionId?: string;
}

const SOURCES: readonly MessageSource[] = [
  "claude-code-jsonl",
  "openai-jsonl",
  "codex-jsonl"
];

const ROLES: readonly MessageRole[] = [
  "system",
  "developer",
  "user",
  "assistant",
  "tool",
  "unknown"
];

const DECISIONS: readonly Decision[] = [
  "keep",
  "keep_protected",
  "compress_candidate",
  "remove_candidate"
];

export function validatePhase0CompressedArtifact(
  contents: string | Buffer,
  file: string,
  source: unknown,
  reportMessages: readonly unknown[]
): Phase0CompressedValidation {
  if (!isSource(source)) return unavailable();

  const expected: ComparableMessage[] = [];
  for (const value of reportMessages) {
    const message = normalizeReportMessage(value, source);
    if (!message) return unavailable();
    if (message.decision !== "remove_candidate") {
      expected.push(message.comparable);
    }
  }

  let parsed: NormalizedMessage[];
  try {
    const input = typeof contents === "string" ? contents : contents.toString("utf8");
    parsed = parseForSource(input, file, source);
  } catch {
    return {
      status: "invalid_structure",
      expected_messages: expected.length,
      parsed_messages: 0
    };
  }

  const expectedMultiset = createMultiset(expected);
  const actualMultiset = createMultiset(parsed);
  return {
    status: multisetsEqual(expectedMultiset, actualMultiset)
      ? "matched"
      : "message_set_mismatch",
    expected_messages: expected.length,
    parsed_messages: parsed.length
  };
}

function parseForSource(
  input: string,
  file: string,
  source: MessageSource
): NormalizedMessage[] {
  if (source === "claude-code-jsonl") return parseClaudeCodeJsonl(input, file);
  if (source === "codex-jsonl") return parseCodexJsonl(input, file);
  return parseOpenAiJsonl(input, file);
}

function normalizeReportMessage(
  value: unknown,
  source: MessageSource
): { comparable: ComparableMessage; decision: Decision } | undefined {
  if (!isRecord(value)
      || !isRole(value.role)
      || typeof value.content !== "string"
      || value.source !== source
      || !isDecision(value.decision)
      || !isOptionalString(value.timestamp)
      || !isOptionalString(value.sessionId)) {
    return undefined;
  }

  return {
    comparable: {
      source,
      role: value.role,
      content: value.content,
      ...(value.timestamp === undefined ? {} : { timestamp: value.timestamp }),
      ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId })
    },
    decision: value.decision
  };
}

function createMultiset(messages: readonly ComparableMessage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([
        message.source,
        message.role,
        message.content,
        message.timestamp ?? null,
        message.sessionId ?? null
      ]))
      .digest("hex");
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return counts;
}

function multisetsEqual(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false;
  return [...left].every(([fingerprint, count]) => right.get(fingerprint) === count);
}

function unavailable(): Phase0CompressedValidation {
  return {
    status: "reference_unavailable",
    expected_messages: 0,
    parsed_messages: 0
  };
}

function isSource(value: unknown): value is MessageSource {
  return typeof value === "string" && SOURCES.some((source) => source === value);
}

function isRole(value: unknown): value is MessageRole {
  return typeof value === "string" && ROLES.some((role) => role === value);
}

function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && DECISIONS.some((decision) => decision === value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
