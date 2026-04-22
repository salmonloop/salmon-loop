import { describe, expect, it } from 'bun:test';

import { resolveExecutionProfile } from '../../../../src/core/runtime/execution-profile.js';

describe('resolveExecutionProfile', () => {
  it('maps recipe modes to the recipe driver with explicit dirty-preflight semantics', () => {
    expect(resolveExecutionProfile('patch')).toEqual(
      expect.objectContaining({
        mode: 'patch',
        driver: 'recipe',
        readOnly: false,
        ignoreDirtyPreflight: false,
      }),
    );

    expect(resolveExecutionProfile('review')).toEqual(
      expect.objectContaining({
        mode: 'review',
        driver: 'recipe',
        readOnly: true,
        ignoreDirtyPreflight: true,
      }),
    );

    expect(resolveExecutionProfile('debug')).toEqual(
      expect.objectContaining({
        mode: 'debug',
        driver: 'recipe',
        readOnly: false,
        ignoreDirtyPreflight: false,
      }),
    );

    expect(resolveExecutionProfile('research')).toEqual(
      expect.objectContaining({
        mode: 'research',
        driver: 'recipe',
        readOnly: true,
        ignoreDirtyPreflight: true,
      }),
    );

    expect(resolveExecutionProfile('answer')).toEqual(
      expect.objectContaining({
        mode: 'answer',
        driver: 'recipe',
        readOnly: true,
        ignoreDirtyPreflight: true,
      }),
    );
  });

  it('maps autopilot to the agent driver with direct yolo defaults', () => {
    expect(resolveExecutionProfile('autopilot')).toEqual({
      mode: 'autopilot',
      driver: 'agent',
      readOnly: false,
      defaultPermissionMode: 'yolo',
      defaultCheckpointStrategy: 'direct',
      ignoreDirtyPreflight: true,
      failurePolicy: 'preserve',
      verifyPolicy: 'required_before_success_if_mutated',
      entryPhase: 'AUTOPILOT',
    });
  });
});
