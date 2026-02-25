import { mock } from 'bun:test';

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

beforeAll(() => {
  // Placeholder hook if future env setup is needed.
});

afterAll(() => {
  restoreConsoleOutputs();
  mock.restore();
});
