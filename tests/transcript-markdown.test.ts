import { describe, expect, test } from "vitest";
import {
  TRANSCRIPT_FORMAT_VERSION,
  formatTranscriptMarkdown
} from "../src/core/transcript-markdown.js";
import type { NormalizedMessage } from "../src/types/message.js";

describe("formatTranscriptMarkdown", () => {
  test("renders all six roles in parser order with input and optional audit metadata", () => {
    const messages: NormalizedMessage[] = [
      message("system-1", "system", "system body", 31, {
        timestamp: "2026-07-30T01:02:03.000Z"
      }),
      message("developer-2", "developer", "developer body", 7, {
        parentId: "parent`one",
        sessionId: "session`main"
      }),
      message("user-3", "user", "user body", 99),
      message("assistant`4", "assistant", "assistant tool input", 12, {
        tool: {
          toolName: "Read`File",
          toolUseId: "tool`use-4",
          isToolUse: true
        }
      }),
      message("tool-5", "tool", "tool output", 13, {
        tool: {
          toolName: "Read",
          toolResultFor: "tool`use-4",
          isToolResult: true
        }
      }),
      message("unknown-6", "unknown", "", 2)
    ];
    const file = "E:/private/session`[audit].jsonl";
    const sha256 = "a".repeat(64);

    const result = formatTranscriptMarkdown({ file, sha256, messages });

    expect(TRANSCRIPT_FORMAT_VERSION).toBe("trimctx.transcript.v1");
    expect(result.source).toBe("claude-code-jsonl");
    expect(result.sessionId).toBe("session`main");
    expect(result.messageCount).toBe(6);
    expect(result.markdown).toContain("# trimctx Conversation Transcript");
    expect(result.markdown).toContain("contains unredacted system instructions, conversation content, and tool data");
    expect(result.markdown).toContain("Review it before sharing");
    expect(result.markdown).toContain("parser-normalized transcript");
    expect(result.markdown).toContain("not a byte-for-byte raw JSONL backup");
    expect(result.markdown).toContain("Codex encrypted reasoning");
    expect(result.markdown).toContain("runtime records ignored by the current parser");
    expect(result.markdown).toContain("- format_version: `trimctx.transcript.v1`");
    expect(result.markdown).toContain(`- source_file: \`\`${file}\`\``);
    expect(result.markdown).toContain(`- source_sha256: \`${sha256}\``);
    expect(result.markdown).toContain("- source_format: `claude-code-jsonl`");
    expect(result.markdown).toContain("- session_id: ``session`main``");
    expect(result.markdown).toContain("- message_count: `6`");

    const headings = [
      "### Message 1 - System",
      "### Message 2 - Developer",
      "### Message 3 - User",
      "### Message 4 - Assistant",
      "### Message 5 - Tool",
      "### Message 6 - Unknown"
    ];
    const headingIndexes = headings.map(heading => result.markdown.indexOf(heading));
    for (const index of headingIndexes) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let index = 1; index < headingIndexes.length; index += 1) {
      expect(headingIndexes[index]!).toBeGreaterThan(headingIndexes[index - 1]!);
    }

    const contentIndexes = [
      "system body",
      "developer body",
      "user body",
      "assistant tool input",
      "tool output"
    ].map(content => result.markdown.indexOf(content));
    for (const index of contentIndexes) {
      expect(index).toBeGreaterThan(-1);
    }
    for (let index = 1; index < contentIndexes.length; index += 1) {
      expect(contentIndexes[index]!).toBeGreaterThan(contentIndexes[index - 1]!);
    }

    const first = eventSection(result.markdown, 1);
    expect(first).toContain("- sequence: `1`");
    expect(first).toContain("- role: `system`");
    expect(first).toContain("- id: `system-1`");
    expect(first).toContain("- source_line: `31`");
    expect(first).toContain("- timestamp: `2026-07-30T01:02:03.000Z`");

    const second = eventSection(result.markdown, 2);
    expect(second).toContain("- parent_id: ``parent`one``");

    const third = eventSection(result.markdown, 3);
    expect(third).not.toContain("- timestamp:");
    expect(third).not.toContain("- parent_id:");
    expect(third).not.toContain("- tool_name:");
    expect(third).not.toContain("- tool_use_id:");
    expect(third).not.toContain("- tool_result_for:");

    const fourth = eventSection(result.markdown, 4);
    expect(fourth).toContain("- id: ``assistant`4``");
    expect(fourth).toContain("- tool_name: ``Read`File``");
    expect(fourth).toContain("- tool_use_id: ``tool`use-4``");

    const fifth = eventSection(result.markdown, 5);
    expect(fifth).toContain("- tool_name: `Read`");
    expect(fifth).toContain("- tool_result_for: ``tool`use-4``");

    const sixth = eventSection(result.markdown, 6);
    expect(sixth).toContain("```text\n\n```");
  });

  test("preserves every content byte regardless of decision or protected state without redaction or truncation", () => {
    const removableContent = `  api_key=sk-private-value\n${"private-content-".repeat(400)}END  `;
    const protectedContent = "Authorization: Bearer secret-token user@example.com";
    const messages = deepFreeze([
      {
        ...message("remove-me", "assistant", removableContent, 1),
        protected: false,
        decision: "remove_candidate" as const,
        reasons: ["low_value_metadata" as const]
      },
      {
        ...message("protected", "system", protectedContent, 2),
        protected: true,
        decision: "keep_protected" as const,
        reasons: ["system_or_developer_message" as const]
      }
    ]);

    const result = formatTranscriptMarkdown({
      file: "private.jsonl",
      sha256: "b".repeat(64),
      messages
    });

    expect(result.messageCount).toBe(2);
    expect(result.markdown).toContain(`\`\`\`text\n${removableContent}\n\`\`\``);
    expect(result.markdown).toContain(`\`\`\`text\n${protectedContent}\n\`\`\``);
    expect(result.markdown).toContain("sk-private-value");
    expect(result.markdown).toContain("secret-token");
    expect(result.markdown).toContain("user@example.com");
    expect(result.markdown).not.toContain("[REDACTED]");
    expect(result.markdown).not.toContain("...");
  });

  test("uses a strictly longer backtick or tilde fence while preserving Markdown, HTML, Unicode, and whitespace", () => {
    const prefersTildes = [
      "  # 标题 🧪",
      "<div data-x=\"1\">HTML & [Markdown](https://example.test)</div>",
      "```ts",
      "const value = `保留`;",
      "````",
      "~~~",
      "尾部空格  "
    ].join("\n");
    const prefersBackticks = "```\ncontent with ~~~~~~ and `inline`\n~~~\n";
    const tiePrefersBackticks = "````\n~~~~\nUnicode: 你好世界";

    const result = formatTranscriptMarkdown({
      file: "fences.jsonl",
      sha256: "c".repeat(64),
      messages: [
        message("m1", "user", prefersTildes, 1, { source: "openai-jsonl" }),
        message("m2", "assistant", prefersBackticks, 2, { source: "openai-jsonl" }),
        message("m3", "unknown", tiePrefersBackticks, 3, { source: "openai-jsonl" })
      ]
    });

    expect(eventSection(result.markdown, 1)).toContain(`~~~~text\n${prefersTildes}\n~~~~`);
    expect(eventSection(result.markdown, 2)).toContain(`\`\`\`\`text\n${prefersBackticks}\`\`\`\``);
    expect(eventSection(result.markdown, 3)).toContain(`\`\`\`\`\`text\n${tiePrefersBackticks}\n\`\`\`\`\``);
    expect(result.markdown).toContain("<div data-x=\"1\">HTML & [Markdown](https://example.test)</div>");
    expect(result.markdown).toContain("你好世界");
  });

  test.each([
    ["claude-code-jsonl", "Claude Code content blocks may be combined, and repeated streaming frames may be deduplicated"],
    ["openai-jsonl", "OpenAI exports include only messages recognized by the current parser"],
    ["codex-jsonl", "Codex exports omit encrypted reasoning, runtime event/turn metadata, and unknown response subtypes"]
  ] as const)("documents the %s normalization boundary", (source, expectedNote) => {
    const result = formatTranscriptMarkdown({
      file: `${source}.jsonl`,
      sha256: "d".repeat(64),
      messages: [message("m1", "user", "content", 1, { source })]
    });

    expect(result.source).toBe(source);
    expect(result.markdown).toContain(expectedNote);
  });

  test("is deterministic and ends with exactly one newline", () => {
    const input = {
      file: "same-session.jsonl",
      sha256: "e".repeat(64),
      messages: [message("m1", "assistant", "same content\n", 8)]
    } as const;

    const first = formatTranscriptMarkdown(input);
    const second = formatTranscriptMarkdown(input);

    expect(first).toEqual(second);
    expect(first.markdown.endsWith("\n")).toBe(true);
    expect(first.markdown.endsWith("\n\n")).toBe(false);
  });

  test("preserves leading and trailing spaces in inline audit metadata", () => {
    const result = formatTranscriptMarkdown({
      file: " session.jsonl ",
      sha256: "f".repeat(64),
      messages: [message(" message-id ", "user", "content", 1)]
    });

    expect(result.markdown).toContain("- source_file: `  session.jsonl  `");
    expect(result.markdown).toContain("- id: `  message-id  `");
  });

  test("rejects an empty normalized conversation with the source file in the error", () => {
    expect(() => formatTranscriptMarkdown({
      file: "E:/empty/session.jsonl",
      sha256: "f".repeat(64),
      messages: []
    })).toThrow("No conversation messages found in E:/empty/session.jsonl");
  });
});

function message(
  id: string,
  role: NormalizedMessage["role"],
  content: string,
  sourceLine: number,
  overrides: Partial<NormalizedMessage> = {}
): NormalizedMessage {
  return {
    id,
    role,
    content,
    source: "claude-code-jsonl",
    sourceLine,
    rawLine: JSON.stringify({ id, role, content }),
    raw: { id, role, content },
    ...overrides
  };
}

function eventSection(markdown: string, sequence: number): string {
  const start = markdown.indexOf(`### Message ${sequence} -`);
  const next = markdown.indexOf(`\n\n### Message ${sequence + 1} -`, start);
  return markdown.slice(start, next === -1 ? undefined : next);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
