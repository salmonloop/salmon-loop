/**
 * Context effectiveness module.
 *
 * Provides tracking and metrics for context quality.
 *
 * @example
 * ```typescript
 * import { ContextEffectivenessTracker, getEffectivenessTracker } from './effectiveness/index.js';
 *
 * const tracker = getEffectivenessTracker();
 *
 * // Record usage
 * tracker.recordUsage('src/file.ts', true, 500, 85);
 *
 * // Get metrics
 * const metrics = tracker.getMetrics();
 * console.log(`Usage rate: ${metrics.avgUsageRate}`);
 *
 * // Get recommendations
 * const recommendations = tracker.getRecommendations();
 * ```
 */

export {
  ContextEffectivenessTracker,
  getEffectivenessTracker,
  resetEffectivenessTracker,
} from './tracker.js';

export type {
  ContextUsageRecord,
  ContextFailureRecord,
  ContextMetrics,
  EffectivenessConfig,
  FileEffectivenessSummary,
} from './types.js';

export { DEFAULT_EFFECTIVENESS_CONFIG } from './types.js';
