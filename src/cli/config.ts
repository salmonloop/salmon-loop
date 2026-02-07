import type { AsyncQueueOptions } from './utils/asyncQueue.js';

export const CHAT_QUEUE_CONFIG = {
  MAX_SIZE: 10,
  OVERFLOW_STRATEGY: 'reject' as AsyncQueueOptions['overflowStrategy'],
  THINKING_SHOW_DELAY_MS: 50, // Reduced from 120ms for faster response feel
  THINKING_MIN_VISIBLE_MS: 150, // Reduced from 300ms to minimize perceived lag
  TASK_TIMEOUT_MS: 10 * 60 * 1000,
};

export const TOOL_AUTH_CONFIG = {
  SESSION_TTL_MS: 30 * 60 * 1000,
  AUTO_ALLOW_RISK: {
    low: true,
    medium: false,
    high: false,
  },
};
