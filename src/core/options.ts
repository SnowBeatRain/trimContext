export interface AnalysisOptions {
  recentWindow?: number;
  removeThreshold?: number;
  compressThreshold?: number;
}

export interface ResolvedAnalysisOptions {
  recentWindow: number;
  removeThreshold: number;
  compressThreshold: number;
}

const DEFAULT_ANALYSIS_OPTIONS: ResolvedAnalysisOptions = {
  recentWindow: 30,
  removeThreshold: 0.8,
  compressThreshold: 0.6
};

export function resolveAnalysisOptions(options: AnalysisOptions = {}): ResolvedAnalysisOptions {
  const resolved = {
    recentWindow: options.recentWindow ?? DEFAULT_ANALYSIS_OPTIONS.recentWindow,
    removeThreshold: options.removeThreshold ?? DEFAULT_ANALYSIS_OPTIONS.removeThreshold,
    compressThreshold: options.compressThreshold ?? DEFAULT_ANALYSIS_OPTIONS.compressThreshold
  };

  if (!Number.isInteger(resolved.recentWindow) || resolved.recentWindow < 0) {
    throw new Error("recent-window must be a non-negative integer");
  }
  if (!isRatio(resolved.removeThreshold)) {
    throw new Error("remove-threshold must be between 0 and 1");
  }
  if (!isRatio(resolved.compressThreshold)) {
    throw new Error("compress-threshold must be between 0 and 1");
  }
  if (resolved.compressThreshold > resolved.removeThreshold) {
    throw new Error("compress-threshold must be less than or equal to remove-threshold");
  }

  return resolved;
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
