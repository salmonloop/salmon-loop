import { afterAll, afterEach, beforeAll } from 'bun:test';

import { PluginLoader } from '../src/core/plugin/loader.js';

import {
  clearMockState,
  muteConsoleOutputs,
  restoreConsoleOutputs,
} from './helpers/bun-test-harness.ts';

muteConsoleOutputs();

beforeAll(async () => {
  // Ensure plugins are loaded for all tests
  await PluginLoader.loadPlugins();
});

afterEach(() => {
  // Keep mocks clean between unit tests
  clearMockState();
});

afterAll(() => {
  // CRITICAL SAFETY: Ensure no mocks leak between tests and restore console
  restoreConsoleOutputs();
});
