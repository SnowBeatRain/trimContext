import { createRequire } from "node:module";
import type { TokenBreakdown, TokenMetadata } from "../../types/message.js";
import type { Tokenizer } from "./index.js";
import { MESSAGE_OVERHEAD_TOKENS } from "./heuristic.js";

interface TiktokenEncoder {
  encode(text: string): ArrayLike<number> | Uint32Array | number[];
  free?: () => void;
}

type EncoderFactory = () => TiktokenEncoder | undefined;

export function createTiktokenTokenizer(): Tokenizer | undefined {
  return createTiktokenTokenizerFromFactory(loadJsTiktokenEncoder);
}

export function createTiktokenTokenizerForTesting(factory: EncoderFactory): Tokenizer | undefined {
  return createTiktokenTokenizerFromFactory(factory);
}

function createTiktokenTokenizerFromFactory(factory: EncoderFactory): Tokenizer | undefined {
  try {
    const encoder = factory();
    return encoder ? new TiktokenTokenizer(encoder) : undefined;
  } catch {
    return undefined;
  }
}

function loadJsTiktokenEncoder(): TiktokenEncoder | undefined {
  try {
    const require = createRequire(import.meta.url);
    const mod = require("js-tiktoken") as { encodingForModel?: (model: string) => TiktokenEncoder };
    return mod.encodingForModel?.("gpt-4o");
  } catch {
    return undefined;
  }
}

class TiktokenTokenizer implements Tokenizer {
  readonly name = "tiktoken";
  readonly confidence = "high";

  constructor(private readonly encoder: TiktokenEncoder) {}

  count(text: string): number {
    return this.encoder.encode(text).length;
  }

  countMessage(content: string): number {
    return this.count(content) + MESSAGE_OVERHEAD_TOKENS;
  }

  analyze(text: string): TokenMetadata {
    return {
      estimator: "tiktoken",
      estimator_version: "tiktoken-v1",
      estimated: false,
      confidence: "high",
      estimated_tokens: this.count(text),
      message_overhead_tokens: 0,
      breakdown: createExactBreakdown(text)
    };
  }

  analyzeMessage(content: string): TokenMetadata {
    const metadata = this.analyze(content);
    return {
      ...metadata,
      estimated_tokens: metadata.estimated_tokens + MESSAGE_OVERHEAD_TOKENS,
      message_overhead_tokens: MESSAGE_OVERHEAD_TOKENS
    };
  }
}

function createExactBreakdown(text: string): TokenBreakdown {
  return {
    cjk_chars: text.match(/[\u3400-\u9fff]/g)?.length ?? 0,
    ascii_tokens: 0,
    latin_words: text.match(/[A-Za-z_]+/g)?.length ?? 0,
    numbers: text.match(/\b\d+(?:\.\d+)?\b/g)?.length ?? 0,
    symbols: text.match(/[^\sA-Za-z0-9_\u3400-\u9fff]/g)?.length ?? 0,
    whitespace_runs: text.match(/\s+/g)?.length ?? 0,
    code_like_segments: countMatches(text, /```[\s\S]*?```|\b(?:function|const|let|class|import|export|return)\b/g),
    path_like_segments: countMatches(text, /(?:^|\s)(?:\.?\.?\/|~\/|[A-Za-z]:\\|[\w.-]+\/[\w./-]+)/g),
    json_like_segments: countMatches(text, /[{[]\s*"[\w.-]+"\s*:/g),
    line_count: text.length === 0 ? 0 : text.split(/\r?\n/).length,
    char_count: text.length
  };
}

function countMatches(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}
