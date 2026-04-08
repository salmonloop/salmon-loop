import { randomUUID } from 'crypto';

import type { CompactionTracking } from './types.js';

/**
 * Initial compaction tracking state
 */
export function createInitialTracking(): CompactionTracking {
  return {
    compacted: false,
    turnCounter: 0,
    consecutiveFailures: 0,
  };
}

/**
 * Update state on successful compaction
 */
export function onCompactionSuccess(_prev: CompactionTracking): CompactionTracking {
  return {
    compacted: true,
    compactId: randomUUID(),
    turnCounter: 0,
    consecutiveFailures: 0,
    lastCompactedAt: Date.now(),
  };
}

/**
 * Update state on compaction failure (for circuit breaker)
 */
export function onCompactionFailure(prev: CompactionTracking): CompactionTracking {
  return {
    ...prev,
    consecutiveFailures: prev.consecutiveFailures + 1,
  };
}

/**
 * Increment turn counter after successful execution cycle
 */
export function onNormalTurnComplete(prev: CompactionTracking): CompactionTracking {
  return {
    ...prev,
    turnCounter: prev.turnCounter + 1,
  };
}

/**
 * Check if circuit breaker is tripped
 */
export function isCircuitBreakerTripped(
  tracking: CompactionTracking,
  maxFailures: number,
): boolean {
  return tracking.consecutiveFailures >= maxFailures;
}
