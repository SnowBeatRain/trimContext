import { LocalHeuristicTokenizer } from "./heuristic.js";
import { createTiktokenTokenizer } from "./tiktoken.js";
import type { TokenMetadata, TokenizerConfidence, TokenizerName } from "../../types/message.js";

export type TokenizerPreference = "auto" | TokenizerName;

export interface Tokenizer {
  readonly name: TokenizerName;
  readonly confidence: TokenizerConfidence;
  count(text: string): number;
  countMessage(content: string): number;
  analyze(text: string): TokenMetadata;
  analyzeMessage(content: string): TokenMetadata;
}

export function selectTokenizer(preference: TokenizerPreference = "auto"): Tokenizer {
  if (preference === "tiktoken") {
    return createTiktokenTokenizer() ?? new LocalHeuristicTokenizer();
  }
  if (preference === "heuristic") {
    return new LocalHeuristicTokenizer();
  }
  return createTiktokenTokenizer() ?? new LocalHeuristicTokenizer();
}

export { ApproxTokenizer, LocalHeuristicTokenizer } from "./heuristic.js";
export { createTiktokenTokenizer } from "./tiktoken.js";
