import type { TokenBreakdown, TokenMetadata } from "../../types/message.js";

export const MESSAGE_OVERHEAD_TOKENS = 4;

export class LocalHeuristicTokenizer {
  readonly name = "local_heuristic";
  readonly confidence = "medium";

  count(text: string): number {
    const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const ascii = text.replace(/[\u3400-\u9fff]/g, " ");
    const words = ascii.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;
    return Math.max(1, cjk + words);
  }

  countMessage(content: string): number {
    return this.count(content) + MESSAGE_OVERHEAD_TOKENS;
  }

  analyze(text: string): TokenMetadata {
    return {
      estimator: "local_heuristic",
      estimator_version: "approx-v1",
      estimated: true,
      confidence: "medium",
      estimated_tokens: this.count(text),
      message_overhead_tokens: 0,
      breakdown: createBreakdown(text)
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

export class ApproxTokenizer extends LocalHeuristicTokenizer {}

function createBreakdown(text: string): TokenBreakdown {
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const ascii = text.replace(/[\u3400-\u9fff]/g, " ");
  const asciiTokens = ascii.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;

  return {
    cjk_chars: cjkChars,
    ascii_tokens: asciiTokens,
    latin_words: ascii.match(/[A-Za-z_]+/g)?.length ?? 0,
    numbers: ascii.match(/\b\d+(?:\.\d+)?\b/g)?.length ?? 0,
    symbols: ascii.match(/[^\sA-Za-z0-9_]/g)?.length ?? 0,
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
