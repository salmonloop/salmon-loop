/**
 * Shared test fixture factories for sub-agent tests.
 * Provides properly typed mock objects to eliminate `as any` casts.
 */
import { mock } from 'bun:test';

import { createTaskEventBus } from '../../src/core/interaction/events/bus.js';
import type { SubAgentControllerPort } from '../../src/core/sub-agent/controller.js';
import type {
  SubAgentManagerDeps,
  SubAgentRuntimeEnvironment,
} from '../../src/core/sub-agent/core/manager.js';
import type { SubAgentProfile, SubAgentContextSnapshot } from '../../src/core/sub-agent/types.js';
import type { ToolRuntimeCtx } from '../../src/core/tools/types.js';

// ─── ToolRuntimeCtx ───────────────────────────────────────────────

export function createMockToolRuntimeCtx(overrides?: Partial<ToolRuntimeCtx>): ToolRuntimeCtx {
  return {
    repoRoot: '/repo',
    attemptId: 1,
    dryRun: false,
    llm: {
      chat: mock(async () => ({ role: 'assistant', content: '' })),
      createPlan: mock(async () => ({})),
      createPatch: mock(async () => ({})),
    },
    ...overrides,
  } as ToolRuntimeCtx;
}

// ─── SubAgentControllerPort ───────────────────────────────────────

export function createMockController(): SubAgentControllerPort {
  return {
    registerAgent: mock(),
    updateStatus: mock(),
    appendLog: mock(),
    addTokenUsage: mock(),
    recordToolCall: mock(),
    onToolCall: mock(() => () => {}),
    listAgents: mock(() => []),
    getAgent: mock(() => undefined),
    tailLogs: mock(() => []),
    requestStop: mock(() => true),
    isStopRequested: mock(() => false),
  };
}

// ─── SubAgentRuntimeEnvironment ───────────────────────────────────

export function createMockRuntimeEnv(
  overrides?: Partial<SubAgentRuntimeEnvironment>,
): SubAgentRuntimeEnvironment {
  return {
    setup: mock(async () => {}),
    teardown: mock(async () => {}),
    ...overrides,
  };
}

// ─── SubAgentManagerDeps ──────────────────────────────────────────

export function createMockDeps(overrides?: Partial<SubAgentManagerDeps>): SubAgentManagerDeps {
  return {
    registry: {
      get: mock(() => ({
        id: 'surgeon',
        name: 'Surgeon',
        role: 'Coder',
        description: 'test',
        allowedTools: [],
        readOnly: false,
        stratagem: 'surgeon',
        timeoutMs: 1000,
      })),
    },
    createRuntimeEnvironment: () => createMockRuntimeEnv(),
    artifactStore: { saveText: mock(async () => 's8p://mock/artifact') },
    eventBus: createTaskEventBus(),
    ...overrides,
  };
}

// ─── SubAgentProfile presets ──────────────────────────────────────

export const EXPLORER_PROFILE: SubAgentProfile = {
  id: 'explorer',
  name: 'Explorer',
  role: 'explorer',
  description: 'Read-only exploration agent',
  allowedTools: ['fs.read', 'code.search'],
  readOnly: true,
  stratagem: 'investigator',
  maxAttempts: 1,
  timeoutMs: 60_000,
};

export const SURGEON_PROFILE: SubAgentProfile = {
  id: 'surgeon',
  name: 'Surgeon',
  role: 'Coder',
  description: 'Implementation proposal agent',
  allowedTools: ['fs.read', 'fs.write', 'code.search', 'shell.exec'],
  readOnly: false,
  stratagem: 'surgeon',
  maxAttempts: 3,
  timeoutMs: 120_000,
};

export const REVIEWER_PROFILE: SubAgentProfile = {
  id: 'reviewer',
  name: 'Reviewer',
  role: 'reviewer',
  description: 'Read-only audit agent',
  allowedTools: ['fs.read', 'code.search'],
  readOnly: true,
  stratagem: 'investigator',
  maxAttempts: 1,
  timeoutMs: 60_000,
};

export const CLEANER_PROFILE: SubAgentProfile = {
  id: 'cleaner',
  name: 'Cleaner',
  role: 'janitor',
  description: 'Lint and format cleanup agent',
  allowedTools: ['fs.read', 'fs.write', 'shell.exec'],
  readOnly: false,
  stratagem: 'janitor',
  maxAttempts: 1,
  timeoutMs: 60_000,
};

// ─── SubAgentContextSnapshot presets ──────────────────────────────

export function createCompatibleCacheSharing(): SubAgentContextSnapshot['cacheSharing'] {
  return {
    contextHash: 'ctx-shared',
    toolSchemaHash: 'tool-hash-shared',
    systemPrefixDigest: 'prefix-shared',
  };
}

export function createSharedSnapshot(
  overrides?: Partial<SubAgentContextSnapshot>,
): SubAgentContextSnapshot {
  return {
    version: 1,
    cacheSharing: createCompatibleCacheSharing(),
    ...overrides,
  };
}
