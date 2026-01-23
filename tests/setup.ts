/**
 * Global Test Setup
 *
 * This file runs before each test to ensure clean state and prevent
 * test pollution from global singletons and mocks.
 *
 * Key responsibilities:
 * - Clear Git cache
 * - Clear all mocks
 * - Clean up timers
 *
 * Note: Monitor instances are handled per-test via new Monitor() pattern,
 * so we don't reset the global singleton here.
 */

import { beforeEach, afterEach, vi } from 'vitest';

import { clearGitCache } from '../src/core/git.js';

/**
 * Before each test: Reset shared global state
 */
beforeEach(() => {
  // Clear Git diff cache
  clearGitCache();

  // Clear all mocks and spies
  vi.clearAllMocks();
});

/**
 * After each test: Clean up resources
 */
afterEach(() => {
  // Restore real timers (in case a test used fake timers)
  vi.useRealTimers();

  // Clear all mocks again for safety
  vi.clearAllMocks();
});
