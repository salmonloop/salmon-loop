import { afterAll, beforeAll, vi } from 'vitest';

import { PluginLoader } from '../src/core/plugin/loader.js';

// Testing guidelines: keep test runs silent and self-validating.
// Many production paths use the shared logger, which delegates to console.*.
// We stub console output in tests to avoid noisy stdout/stderr and make CI output stable.

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  // Ensure plugins are loaded for all tests
  await PluginLoader.loadPlugins();
});

afterAll(() => {
  vi.restoreAllMocks();
});
