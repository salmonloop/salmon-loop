import { describe, expect, test, mock } from 'bun:test';
import { createCliTaskRunner } from '../../../../src/interfaces/cli/task-runner.js';
import { buildCanonicalExecutionRequest } from '../../../../src/core/protocols/shared/execution-request.js';

describe('createCliTaskRunner', () => {
  test('run() calls facade.createTask with the expected canonical execution request', async () => {
    const mockCreateTask = mock(async () => 'task-result');
    const facade = { createTask: mockCreateTask };

    const runner = createCliTaskRunner({ facade });

    const input = {
      capability: 'some-capability',
      instruction: 'do something',
    };

    const result = await runner.run(input);

    expect(result).toBe('task-result');
    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask).toHaveBeenCalledWith(
      buildCanonicalExecutionRequest({
        capability: input.capability,
        instruction: input.instruction,
      })
    );
  });
});
