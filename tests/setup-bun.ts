import { mock } from 'bun:test';

import {
  clearPluginRegistry,
  createPluginRegistry,
  setPluginRegistry,
} from '../src/core/plugin/registry.js';

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
  const registry = createPluginRegistry();
  setPluginRegistry(registry);
});

afterAll(() => {
  clearPluginRegistry();
  restoreConsoleOutputs();
  mock.restore();
});
