import { createInterface } from "node:readline";
import { parseInitTarget, type InitTarget } from "./init-plan.js";

export interface InitPrompt {
  question(prompt: string): Promise<string>;
  close?(): void;
}

export class PromptSession implements InitPrompt {
  private readonly readline = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  private readonly pendingResolvers: Array<(line: string) => void> = [];
  private readonly lines: string[] = [];
  private ended = false;

  constructor() {
    this.readline.on("line", (line) => {
      const resolveNext = this.pendingResolvers.shift();
      if (resolveNext) {
        resolveNext(line);
      } else {
        this.lines.push(line);
      }
    });
    this.readline.on("close", () => {
      this.ended = true;
      while (this.pendingResolvers.length > 0) {
        this.pendingResolvers.shift()?.("");
      }
    });
  }

  async question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    const line = this.lines.shift();
    if (line !== undefined || this.ended) {
      return line ?? "";
    }
    return await new Promise((resolve) => this.pendingResolvers.push(resolve));
  }

  close(): void {
    this.readline.close();
  }
}

export function isInteractiveInput(
  env: NodeJS.ProcessEnv = process.env,
  inputIsTty = Boolean(process.stdin.isTTY),
  outputIsTty = Boolean(process.stdout.isTTY)
): boolean {
  return env.TRIMCTX_FORCE_INTERACTIVE === "1" || (inputIsTty && outputIsTty);
}

export async function resolveInitTarget(
  value: string | undefined,
  prompt?: InitPrompt,
  write: (text: string) => void = (text) => process.stdout.write(text)
): Promise<InitTarget> {
  if (value !== undefined) {
    return parseInitTarget(value);
  }
  if (!prompt) {
    throw new Error("target is required in non-interactive mode; pass --target user or --target project");
  }

  for (;;) {
    const answer = (await prompt.question([
      "Where should trimctx install AI-client assets?",
      "  1) User/global: ~/.claude/plugins/trimctx and ~/.codex/skills/trimctx",
      "  2) Project: ./.claude/plugins/trimctx and ./.codex/skills/trimctx",
      "Choose 1 or 2 [1]: "
    ].join("\n"))).trim().toLowerCase();
    if (answer === "" || answer === "1" || answer === "user" || answer === "global") {
      return "user";
    }
    if (answer === "2" || answer === "project" || answer === "local") {
      return "project";
    }
    write("Please choose 1 for user/global or 2 for project.\n");
  }
}
