import { afterAll, afterEach, beforeAll } from 'bun:test';

import { clearLogger, createLogger, setLogger } from '../src/core/observability/logger.js';
import { clearMonitor, createMonitor, setMonitor } from '../src/core/observability/monitor.js';
import { PluginLoader } from '../src/core/plugin/loader.js';
import {
  clearPluginRegistry,
  createPluginRegistry,
  setPluginRegistry,
} from '../src/core/plugin/registry.js';
import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../src/core/prompts/registry.js';
import { registerDefaultSubAgentProfiles } from '../src/core/sub-agent/registry-defaults.js';
import {
  clearSubAgentRegistry,
  createSubAgentRegistry,
  setSubAgentRegistry,
} from '../src/core/sub-agent/registry.js';

import {
  clearMockState,
  muteConsoleOutputs,
  restoreConsoleOutputs,
} from './helpers/bun-test-harness.ts';

muteConsoleOutputs();

beforeAll(async () => {
  // Ensure plugins are loaded for all tests
  setLogger(createLogger({ silent: true }));
  setMonitor(createMonitor());
  const subAgents = createSubAgentRegistry();
  registerDefaultSubAgentProfiles(subAgents);
  setSubAgentRegistry(subAgents);
  const registry = createPluginRegistry();
  setPluginRegistry(registry);
  setPromptRegistry(createPromptRegistry());
  await PluginLoader.loadPlugins(registry);
});

afterEach(() => {
  // Keep mocks clean between unit tests
  clearMockState();
});

afterAll(() => {
  clearPluginRegistry();
  clearPromptRegistry();
  clearLogger();
  clearMonitor();
  clearSubAgentRegistry();
  // CRITICAL SAFETY: Ensure no mocks leak between tests and restore console
  restoreConsoleOutputs();
});
