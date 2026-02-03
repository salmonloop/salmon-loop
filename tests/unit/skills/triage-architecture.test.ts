import { describe, it, expect } from 'vitest';

import { MicroTaskRunner } from '../../../src/core/skills/runtime/MicroTaskRunner.js';
import { IExecutable, ExecutionContext, Skill } from '../../../src/core/skills/types.js';

describe('Triage Architecture Protocol', () => {
  const mockSkill: Skill = {
    id: 'test-skill',
    path: 'test.md',
    metadata: { name: 'Test', description: 'Testing architecture' },
    instructions: 'Test instructions',
    rawContent: '---metadata---test instructions',
  };

  it('should verify MicroTaskRunner implements IExecutable', () => {
    const runner: IExecutable = new MicroTaskRunner(mockSkill);
    expect(runner).toBeDefined();
    expect(typeof runner.execute).toBe('function');
  });

  it('should verify a mock simple class implements IExecutable', async () => {
    class SimpleExecutable implements IExecutable {
      async execute(inputs: Record<string, any>, ctx: ExecutionContext) {
        return { ok: true, inputCount: Object.keys(inputs).length, depth: ctx.depth };
      }
    }

    const runner: IExecutable = new SimpleExecutable();
    const ctx: ExecutionContext = {
      repoRoot: '/tmp',
      attemptId: 1,
      depth: 3,
      dryRun: false,
    };

    const result = await runner.execute({ a: 1 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.depth).toBe(3);
  });

  it('should validate ExecutionContext depth property contract', () => {
    const ctx: ExecutionContext = {
      repoRoot: '/work',
      attemptId: 42,
      depth: 5,
      traceId: 'trace-123',
      dryRun: false,
    };

    expect(ctx.depth).toBe(5);
    expect(ctx.traceId).toBe('trace-123');
  });
});
