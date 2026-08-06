import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { analyzeClaudeStopFile } from "../src/core/hook-analysis.js";

describe("Claude Stop analysis snapshot", () => {
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
