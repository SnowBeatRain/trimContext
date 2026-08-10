import { mkdtemp, truncate, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  analyzeClaudeStopFile
} from "../src/core/hook-analysis.js";

const openMock = vi.hoisted(() => vi.fn<typeof import("node:fs/promises").open>());

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  openMock.mockImplementation(actual.open);
  return { ...actual, open: openMock };
});

const MAX_HOOK_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_HOOK_TRANSCRIPT_MESSAGES = 10_000;

describe("Claude Stop analysis snapshot", () => {
  test("rejects a non-regular transcript before parsing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trimctx-hook-analysis-directory-"));

    await expect(analyzeClaudeStopFile(directory)).rejects.toThrow(
      `Claude Stop transcript must be a regular file: ${directory}`
    );
  });

  test("rejects a transcript larger than the byte limit before parsing", async () => {
    const file = await writeTranscript([{ type: "user", uuid: "m-1", message: { role: "user", content: "private transcript body" } }]);
    await truncate(file, MAX_HOOK_TRANSCRIPT_BYTES + 1);

    await expect(analyzeClaudeStopFile(file)).rejects.toThrow(
      `Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_BYTES} bytes: ${file}`
    );
  });

  test("uses bounded reads when a transcript grows after the initial stat", async () => {
    const input = Buffer.from(`${JSON.stringify({
      type: "user",
      uuid: "m-1",
      message: { role: "user", content: "bounded content" }
    })}\n`);
    let offset = 0;
    const read = vi.fn(async (buffer: Buffer, _bufferOffset: number, length: number) => {
      if (offset >= input.byteLength) return { bytesRead: 0, buffer };
      const bytesRead = Math.min(length, input.byteLength - offset);
      input.copy(buffer, 0, offset, offset + bytesRead);
      offset += bytesRead;
      return { bytesRead, buffer };
    });
    const readFile = vi.fn(() => {
      throw new Error("unbounded read invoked");
    });
    const close = vi.fn(async () => undefined);
    openMock.mockResolvedValueOnce({
      stat: async () => ({ isFile: () => true, size: 1 }),
      read,
      readFile,
      close
    } as unknown as FileHandle);

    const report = await analyzeClaudeStopFile("growing-transcript.jsonl");

    expect(report.summary.total_messages).toBe(1);
    expect(readFile).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.every(([, , length]) => length <= 64 * 1024)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  test("rejects too many normalized messages before analysis", async () => {
    const records = Array.from({ length: MAX_HOOK_TRANSCRIPT_MESSAGES + 1 }, (_, index) => ({
      type: "user",
      uuid: `message-${index}`,
      message: { role: "user", content: "bounded content" }
    }));
    const file = await writeTranscript(records);

    await expect(analyzeClaudeStopFile(file)).rejects.toThrow(
      `Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_MESSAGES} normalized messages`
    );
  });

  test("counts a supplemental final assistant message toward the message limit", async () => {
    const records = Array.from({ length: MAX_HOOK_TRANSCRIPT_MESSAGES }, (_, index) => ({
      type: "user",
      uuid: `message-${index}`,
      message: { role: "user", content: "bounded content" }
    }));
    const file = await writeTranscript(records);

    await expect(analyzeClaudeStopFile(file, "final assistant body")).rejects.toThrow(
      `Claude Stop transcript exceeds ${MAX_HOOK_TRANSCRIPT_MESSAGES} normalized messages`
    );
  });

  test("supplements a missing final assistant reply through the complete analysis pipeline", async () => {
    const file = await writeTranscript([
      {
        type: "user",
        uuid: "user-1",
        sessionId: "session-1",
        message: { role: "user", content: "Goal: stabilize the release workflow." }
      }
    ]);
    const finalReply = "Next step: run the release checks.";

    const report = await analyzeClaudeStopFile(file, finalReply);

    expect(report.summary.total_messages).toBe(2);
    expect(report.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: finalReply,
      source: "claude-code-jsonl",
      sourceLine: 1,
      sessionId: "session-1",
      protected: true,
      decision: "keep_protected"
    });
    expect(report.messages.at(-1)?.id).toContain("trimctx:hook:last-assistant-message");
    expect(report.messages.at(-1)?.reasons).toContain("recent_message");
    expect(report.resume.nextSteps.at(-1)?.text).toBe(finalReply);
  });

  test("deduplicates the newest assistant reply across line endings and trailing metadata", async () => {
    const file = await writeTranscript([
      {
        type: "assistant",
        uuid: "assistant-final",
        sessionId: "session-1",
        message: { role: "assistant", content: "Final answer\nNext step: run tests." }
      },
      {
        type: "system",
        uuid: "system-after",
        sessionId: "session-1",
        message: { role: "system", content: "turn duration metadata" }
      }
    ]);

    const report = await analyzeClaudeStopFile(
      file,
      "\r\nFinal answer\r\nNext step: run tests.\r\n"
    );

    expect(report.summary.total_messages).toBe(2);
    expect(report.messages.some((message) =>
      message.id.includes("trimctx:hook:last-assistant-message")
    )).toBe(false);
  });

  test("does not mistake an older matching assistant reply for the current final reply", async () => {
    const file = await writeTranscript([
      {
        type: "assistant",
        uuid: "assistant-older",
        message: { role: "assistant", content: "Repeated answer" }
      },
      {
        type: "user",
        uuid: "user-current",
        message: { role: "user", content: "Please answer this turn too." }
      },
      {
        type: "assistant",
        uuid: "assistant-intermediate",
        message: { role: "assistant", content: "Different intermediate answer" }
      }
    ]);

    const report = await analyzeClaudeStopFile(file, "Repeated answer");

    expect(report.summary.total_messages).toBe(4);
    expect(report.messages.at(-1)?.content).toBe("Repeated answer");
    expect(report.messages.at(-1)?.id).toContain("trimctx:hook:last-assistant-message");
  });

  test.each([undefined, "", " \r\n "])(
    "ignores an absent or blank final reply: %s",
    async (lastAssistantMessage) => {
      const file = await writeTranscript([
        {
          type: "user",
          uuid: "user-only",
          message: { role: "user", content: "A short session" }
        }
      ]);

      const report = await analyzeClaudeStopFile(file, lastAssistantMessage);

      expect(report.summary.total_messages).toBe(1);
    }
  );
});

async function writeTranscript(records: unknown[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "trimctx-hook-analysis-"));
  const file = join(directory, "session.jsonl");
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  return file;
}
