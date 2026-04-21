import { describe, expect, it } from 'bun:test';

import { resolveExecutionProfile } from '../../../../src/core/runtime/execution-profile.js';

describe('resolveExecutionProfile', () => {
  it('maps recipe modes to the recipe driver with current mutability semantics', () => {
    expect(resolveExecutionProfile('patch')).toEqual(
      expect.objectContaining({
        mode: 'patch',
        driver: 'recipe',
        readOnly: false,
      }),
    );

    expect(resolveExecutionProfile('review')).toEqual(
      expect.objectContaining({
        mode: 'review',
        driver: 'recipe',
        readOnly: true,
      }),
    );

    expect(resolveExecutionProfile('research')).toEqual(
      expect.objectContaining({
        mode: 'research',
        driver: 'recipe',
        readOnly: true,
      }),
    );

    expect(resolveExecutionProfile('answer')).toEqual(
      expect.objectContaining({
        mode: 'answer',
        driver: 'recipe',
        readOnly: true,
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
      failurePolicy: 'preserve',
      verifyPolicy: 'required_before_success_if_mutated',
      entryPhase: 'AUTOPILOT',
    });
  });
});
