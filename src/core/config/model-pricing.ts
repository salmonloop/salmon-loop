/**
 * Per-model token pricing (USD per 1M tokens).
 *
 * Used to estimate run cost from token counts.
 * Prices are approximate and should be updated when providers change rates.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// prettier-ignore
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-opus-4-7':     { inputPer1M: 15,    outputPer1M: 75 },
  'claude-opus-4-6':     { inputPer1M: 15,    outputPer1M: 75 },
  'claude-sonnet-4-6':   { inputPer1M: 3,     outputPer1M: 15 },
  'claude-sonnet-4-5':   { inputPer1M: 3,     outputPer1M: 15 },
  'claude-haiku-4-5':    { inputPer1M: 0.80,  outputPer1M: 4 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4 },
  'claude-3-opus':       { inputPer1M: 15,    outputPer1M: 75 },
  'claude-3-sonnet':     { inputPer1M: 3,     outputPer1M: 15 },
  'claude-3-haiku':      { inputPer1M: 0.25,  outputPer1M: 1.25 },

  // OpenAI
  'gpt-4o':              { inputPer1M: 2.50,  outputPer1M: 10 },
  'gpt-4o-mini':         { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gpt-4-turbo':         { inputPer1M: 10,    outputPer1M: 30 },
  'gpt-4':               { inputPer1M: 30,    outputPer1M: 60 },
  'o1':                  { inputPer1M: 15,    outputPer1M: 60 },
  'o1-mini':             { inputPer1M: 3,     outputPer1M: 12 },
  'o3-mini':             { inputPer1M: 1.10,  outputPer1M: 4.40 },

  // Google Gemini
  'gemini-2.5-pro':      { inputPer1M: 1.25,  outputPer1M: 10 },
  'gemini-2.5-flash':    { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gemini-2.0-flash':    { inputPer1M: 0.10,  outputPer1M: 0.40 },
};

/**
 * Look up pricing for a model ID.
 * Tries exact match first, then prefix match (e.g. "claude-sonnet-4-6-20250514" matches "claude-sonnet-4-6").
 * Returns undefined if no pricing is available.
 */
export function getModelPricing(modelId: string | undefined): ModelPricing | undefined {
  if (!modelId) return undefined;

  // Exact match
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];

  // Prefix match — try longest prefix first
  const normalized = modelId.toLowerCase();
  for (const key of Object.keys(MODEL_PRICING)) {
    if (normalized.startsWith(key)) return MODEL_PRICING[key];
  }

  return undefined;
}

/**
 * Estimate cost in USD from token counts and model ID.
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  modelId?: string,
): number | undefined {
  const pricing = getModelPricing(modelId);
  if (!pricing) return undefined;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}
