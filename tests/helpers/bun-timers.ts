import { jest } from 'bun:test';

export const {
  advanceTimersByTime,
  advanceTimersToNextTimer,
  runAllTimers,
  runOnlyPendingTimers,
  clearAllTimers,
  getTimerCount,
} = jest;
