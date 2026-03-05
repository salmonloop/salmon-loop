import { mock } from 'bun:test';

import { clearLogger, createLogger, setLogger } from '../src/core/observability/logger.js';
import { clearMonitor, createMonitor, setMonitor } from '../src/core/observability/monitor.js';
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

import {
  afterAll,
  afterEach,
  beforeAll,
  clearMockState,
  ensureDom,
  ensureTestGlobals,
  ensureUiModuleStubs,
  muteConsoleOutputs,
  restoreConsoleOutputs,
} from './helpers/bun-test-harness.ts';

ensureDom();
ensureUiModuleStubs();
ensureTestGlobals();
muteConsoleOutputs();

afterEach(() => {
  clearMockState();
});

beforeAll(async () => {
  setLogger(createLogger({ silent: true }));
  setMonitor(createMonitor());
  const registry = createPluginRegistry();
  setPluginRegistry(registry);
  setPromptRegistry(createPromptRegistry());
});

afterAll(() => {
  clearPluginRegistry();
  clearPromptRegistry();
  clearLogger();
  clearMonitor();
  restoreConsoleOutputs();
  mock.restore();
});
