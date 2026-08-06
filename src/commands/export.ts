import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import type { Command } from "commander";
import { parseJsonl } from "../core/analyzer.js";
import { formatTranscriptMarkdown } from "../core/transcript-markdown.js";
import { assertDifferentFiles, atomicWriteFileDistinctFromInput } from "../platform/files.js";
import { resolveBoundSessionFile } from "../sessions/binding.js";

const OUTPUT_CONFLICT_MESSAGE = "Export output must be different from input file";

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .argument("[file]", "Conversation JSONL file; omit only with a trusted current-window binding.")
    .requiredOption("-o, --output <conversation.md>")
    .description("Export a complete normalized conversation transcript as Markdown.")
    .action(async (file: string | undefined, options: { output: string }) => {
      const inputFile = file ?? await resolveBoundSessionFile();
      await assertDifferentFiles(inputFile, options.output, OUTPUT_CONFLICT_MESSAGE);
      if (extname(options.output).toLowerCase() !== ".md") {
        throw new Error("export output must end in .md");
      }

      const inputHandle = await open(inputFile, "r");
      try {
        const inputSnapshot = await inputHandle.stat();
        const input = await inputHandle.readFile();
        const result = formatTranscriptMarkdown({
          file: inputFile,
          sha256: createHash("sha256").update(input).digest("hex"),
          messages: parseJsonl(input.toString("utf8"), inputFile)
        });
        await atomicWriteFileDistinctFromInput(
          inputHandle,
          options.output,
          result.markdown,
          OUTPUT_CONFLICT_MESSAGE,
          inputSnapshot
        );
        process.stdout.write([
          `export: ${options.output}`,
          `messages: ${result.messageCount}`,
          `source: ${result.source}`,
          ""
        ].join("\n"));
      } finally {
        await inputHandle.close();
      }
    });
}
