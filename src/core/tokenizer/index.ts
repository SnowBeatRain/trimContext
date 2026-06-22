import { LocalHeuristicTokenizer } from "./heuristic.js";
import { createTiktokenTokenizer } from "./tiktoken.js";
import type { MessageSource, TokenMetadata, TokenizerConfidence, TokenizerName } from "../../types/message.js";

export type TokenizerPreference = "auto" | "heuristic" | TokenizerName;

export interface Tokenizer {
  readonly name: TokenizerName;
  readonly confidence: TokenizerConfidence;
  count(text: string): number;
  countMessage(content: string): number;
  analyze(text: string): TokenMetadata;
  analyzeMessage(content: string): TokenMetadata;
}

export function selectTokenizer(preference: TokenizerPreference = "auto"): Tokenizer {
  if (preference === "heuristic") {
    return new LocalHeuristicTokenizer();
  }
  return createTiktokenTokenizer() ?? new LocalHeuristicTokenizer();
}

export function selectTokenizerForSource(source: MessageSource | undefined, preference: TokenizerPreference = "auto"): Tokenizer {
  if (source === "claude-code-jsonl" && preference === "auto") {
    return new LocalHeuristicTokenizer();
  }
  return selectTokenizer(preference);
}

export { ApproxTokenizer, LocalHeuristicTokenizer } from "./heuristic.js";
export { createTiktokenTokenizer } from "./tiktoken.js";
