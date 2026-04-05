import type { LLMMessage } from '../../types/index.js';

/**
 * State for tracking compaction progress and circuit breakers
 */
export interface CompactionTracking {
  /** Whether any compaction has occurred in this session */
  compacted: boolean;
  /** UUID of the last compaction event */
  compactId?: string;
  /** Number of normal turns since last compaction */
  turnCounter: number;
  /** Consecutive compaction failures for circuit breaker */
  consecutiveFailures: number;
  /** Timestamp of last compaction */
  lastCompactedAt?: number;
}

/**
 * Trigger source for compaction
 */
export type CompactionTrigger = 'auto' | 'manual' | 'reactive';

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** Whether compaction was actually performed */
  performed: boolean;
  /** Rebuilt messages (view for LLM) */
  messages?: LLMMessage[];
  /** Summary produced (for Level 1+) */
  summaryText?: string;
  /** Token count before compaction */
  preTokens?: number;
  /** Token count after compaction */
  postTokens?: number;
  /** Trigger source */
  trigger?: CompactionTrigger;
  /** Updated tracking state */
  tracking: CompactionTracking;
}

/**
 * Level 0: Microcompact configuration (rule-based)
 */
export interface MicrocompactConfig {
  /** Number of recent turns to keep untouched (1 turn = user + assistant pair) */
  keepRecentTurns: number;
  /** Placeholder for cleared tool result content */
  placeholder: string;
  /** Tool names that are "stateful" and should NEVER be cleared */
  statefulTools: string[];
}

/**
 * Level 1: Autocompact configuration (LLM-based)
 */
export interface AutocompactConfig {
  /** Token threshold to trigger autocompact */
  tokenThreshold: number;
  /** Max consecutive failures before circuit breaker trips */
  maxFailures: number;
  /** Number of recent messages to keep in original form */
  keepRecentMessages: number;
}

export const DEFAULT_MICROCOMPACT_CONFIG: MicrocompactConfig = {
  keepRecentTurns: 3, // Keep last 3 rounds (approx 6 messages)
  placeholder: '[Previous tool output cleared for context efficiency]',
  statefulTools: ['cd', 'export', 'env_set', 'enter_worktree', 'exit_worktree'],
};

export const DEFAULT_AUTOCOMPACT_CONFIG: AutocompactConfig = {
  tokenThreshold: 8000,
  maxFailures: 3,
  keepRecentMessages: 10,
};
