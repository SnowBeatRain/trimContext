import type { MessageRole, MessageSource, NormalizedMessage } from "../types/message.js";

export const TRANSCRIPT_FORMAT_VERSION = "trimctx.transcript.v1";

export interface TranscriptMarkdownInput {
  file: string;
  sha256: string;
  messages: readonly NormalizedMessage[];
}

export interface TranscriptMarkdownResult {
  markdown: string;
  source: MessageSource;
  sessionId?: string;
  messageCount: number;
}

const SOURCE_NORMALIZATION_NOTES: Record<MessageSource, string> = {
  "claude-code-jsonl": "Source normalization: Claude Code content blocks may be combined, and repeated streaming frames may be deduplicated by the current parser.",
  "openai-jsonl": "Source normalization: OpenAI exports include only messages recognized by the current parser; unrecognized runtime records remain outside this transcript.",
  "codex-jsonl": "Source normalization: Codex exports omit encrypted reasoning, runtime event/turn metadata, and unknown response subtypes ignored by the current parser."
};

const ROLE_LABELS: Record<MessageRole, string> = {
  system: "System",
  developer: "Developer",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  unknown: "Unknown"
};

export function formatTranscriptMarkdown(input: TranscriptMarkdownInput): TranscriptMarkdownResult {
  if (input.messages.length === 0) {
    throw new Error(`No conversation messages found in ${input.file}`);
  }

  const source = input.messages[0]!.source;
  const sessionId = input.messages.find(message => message.sessionId !== undefined)?.sessionId;
  const metadata = [
    `- format_version: ${codeSpan(TRANSCRIPT_FORMAT_VERSION)}`,
    `- source_file: ${codeSpan(input.file)}`,
    `- source_sha256: ${codeSpan(input.sha256)}`,
    `- source_format: ${codeSpan(source)}`,
    ...(sessionId === undefined ? [] : [`- session_id: ${codeSpan(sessionId)}`]),
    `- message_count: ${codeSpan(input.messages.length)}`
  ];
  const events = input.messages.map((message, index) => formatEvent(message, index + 1));
  const markdown = [
    "# trimctx Conversation Transcript",
    "",
    "> [!WARNING]",
    "> This artifact contains unredacted system instructions, conversation content, and tool data.",
    "> Review it before sharing.",
    "",
    "This is a parser-normalized transcript, not a byte-for-byte raw JSONL backup.",
    "Codex encrypted reasoning and runtime records ignored by the current parser are outside this export contract.",
    SOURCE_NORMALIZATION_NOTES[source],
    "",
    "## Document Metadata",
    "",
    ...metadata,
    "",
    "## Messages",
    "",
    events.join("\n\n")
  ].join("\n");

  return {
    markdown: `${markdown}\n`,
    source,
    ...(sessionId === undefined ? {} : { sessionId }),
    messageCount: input.messages.length
  };
}

function formatEvent(message: NormalizedMessage, sequence: number): string {
  const metadata = [
    `- sequence: ${codeSpan(sequence)}`,
    `- role: ${codeSpan(message.role)}`,
    `- id: ${codeSpan(message.id)}`,
    `- source_line: ${codeSpan(message.sourceLine)}`,
    ...(message.timestamp === undefined ? [] : [`- timestamp: ${codeSpan(message.timestamp)}`]),
    ...(message.parentId === undefined ? [] : [`- parent_id: ${codeSpan(message.parentId)}`]),
    ...(message.tool?.toolName === undefined ? [] : [`- tool_name: ${codeSpan(message.tool.toolName)}`]),
    ...(message.tool?.toolUseId === undefined ? [] : [`- tool_use_id: ${codeSpan(message.tool.toolUseId)}`]),
    ...(message.tool?.toolResultFor === undefined ? [] : [`- tool_result_for: ${codeSpan(message.tool.toolResultFor)}`])
  ];

  return [
    `### Message ${sequence} - ${ROLE_LABELS[message.role]}`,
    "",
    ...metadata,
    "",
    fencedContent(message.content)
  ].join("\n");
}

function fencedContent(content: string): string {
  const backtickLength = Math.max(3, longestRun(content, "`") + 1);
  const tildeLength = Math.max(3, longestRun(content, "~") + 1);
  const fenceCharacter = backtickLength <= tildeLength ? "`" : "~";
  const fenceLength = Math.min(backtickLength, tildeLength);
  const fence = fenceCharacter.repeat(fenceLength);
  const structuralNewline = content.endsWith("\n") ? "" : "\n";

  return `${fence}text\n${content}${structuralNewline}${fence}`;
}

function codeSpan(value: string | number): string {
  const text = String(value).replace(/\r\n?|\n/g, " ");
  const delimiter = "`".repeat(longestRun(text, "`") + 1);
  const needsPadding = /^[ `]|[ `]$/.test(text);

  return needsPadding
    ? `${delimiter} ${text} ${delimiter}`
    : `${delimiter}${text}${delimiter}`;
}

function longestRun(value: string, character: "`" | "~"): number {
  let longest = 0;
  let current = 0;

  for (const entry of value) {
    if (entry === character) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}
