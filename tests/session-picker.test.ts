import { describe, expect, test } from "vitest";
import type { SessionCandidate } from "../src/sessions/catalog.js";
import { formatSessionCandidate, isInteractiveTerminal, selectSession } from "../src/sessions/picker.js";

describe("session picker", () => {
  test("uses stderr as the interactive prompt stream when stdout is redirected", () => {
    const previousForce = process.env.TRIMCTX_FORCE_INTERACTIVE;
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    delete process.env.TRIMCTX_FORCE_INTERACTIVE;

    try {
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
      expect(isInteractiveTerminal()).toBe(true);

      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
      expect(isInteractiveTerminal()).toBe(false);
    } finally {
      restoreProperty(process.stdin, "isTTY", stdinDescriptor);
      restoreProperty(process.stdout, "isTTY", stdoutDescriptor);
      restoreProperty(process.stderr, "isTTY", stderrDescriptor);
      restoreEnv("TRIMCTX_FORCE_INTERACTIVE", previousForce);
    }
  });

  test("formats lightweight session metadata", () => {
    const text = formatSessionCandidate(
      candidate("claude", "project-a", "session-a", 1024),
      new Date("2026-07-16T01:00:00.000Z")
    );

    expect(text).toContain("Claude");
    expect(text).toContain("project-a");
    expect(text).toContain("1.0 KB");
    expect(text).toContain("session-a");
  });

  test("uses the first session for an empty answer", async () => {
    const candidates = [
      candidate("claude", "project-a", "session-a"),
      candidate("codex", "2026/07/16", "session-b")
    ];
    const output: string[] = [];

    const selected = await selectSession(candidates, {
      write: (text) => output.push(text),
      ask: async () => ""
    });

    expect(selected).toBe(candidates[0]);
    expect(output.join("")).toContain("不会恢复或切换 AI 客户端窗口");
  });

  test("selects a session by its one-based number", async () => {
    const candidates = [
      candidate("claude", "project-a", "session-a"),
      candidate("codex", "2026/07/16", "session-b")
    ];

    const selected = await selectSession(candidates, {
      write: () => undefined,
      ask: async () => "2"
    });

    expect(selected).toBe(candidates[1]);
  });

  test("rejects invalid session numbers", async () => {
    const candidates = [
      candidate("claude", "project-a", "session-a"),
      candidate("codex", "2026/07/16", "session-b")
    ];

    await expect(selectSession(candidates, { write: () => undefined, ask: async () => "abc" }))
      .rejects.toThrow("请输入会话编号");
    await expect(selectSession(candidates, { write: () => undefined, ask: async () => "3" }))
      .rejects.toThrow("请选择 1 到 2 之间的编号");
  });

  test("gives actionable commands when no local sessions are available", async () => {
    await expect(selectSession([])).rejects.toThrow("trimctx analyze <file>");
    await expect(selectSession([])).rejects.toThrow("trimctx init --with-hooks");
  });
});

function restoreProperty(
  target: NodeJS.ReadStream | NodeJS.WriteStream,
  name: string,
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor);
  } else {
    delete (target as unknown as Record<string, unknown>)[name];
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function candidate(
  source: SessionCandidate["source"],
  projectLabel: string,
  sessionId: string,
  sizeBytes = 2048
): SessionCandidate {
  const modifiedAt = new Date("2026-07-16T00:30:00.000Z");
  return {
    source,
    projectLabel,
    sessionId,
    sizeBytes,
    file: `C:\\sessions\\${sessionId}.jsonl`,
    modifiedAt,
    mtimeMs: modifiedAt.getTime()
  };
}
