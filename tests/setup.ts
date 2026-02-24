import { afterAll, beforeAll, vi } from 'bun:test';

import { PluginLoader } from '../src/core/plugin/loader.js';

// Testing guidelines: keep test runs silent and self-validating.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  // Ensure plugins are loaded for all tests
  await PluginLoader.loadPlugins();
});

afterAll(() => {
  // CRITICAL SAFETY: Ensure no mocks leak between tests
  vi.restoreAllMocks();
});
