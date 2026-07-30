export function formatTokens(tokens: number, options: { includeUnit?: boolean } = {}): string {
  const suffix = options.includeUnit ? " tokens" : "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M${suffix}`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K${suffix}`;
  return `${tokens}${suffix}`;
}

export function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatScore(score: number): string {
  return score.toFixed(3);
}
