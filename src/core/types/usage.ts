export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Estimated cost in USD (undefined if model pricing is unavailable) */
  estimatedCost?: number;
}
