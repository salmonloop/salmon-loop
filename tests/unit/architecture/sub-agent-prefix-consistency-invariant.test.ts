import { readFile } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'bun:test';

describe('architecture/sub-agent prefix consistency invariant', () => {
  it('task-spawn and manager both validate shared mode against runtime snapshot and fail closed', async () => {
    const taskSpawn = await readFile(
      join(process.cwd(), 'src/core/sub-agent/tools/task-spawn.ts'),
      'utf8',
    );
    const manager = await readFile(join(process.cwd(), 'src/core/sub-agent/core/manager.ts'), 'utf8');

    expect(taskSpawn).toContain('validateSharedPrefixConsistency');
    expect(taskSpawn).toContain('runtimeSnapshot: ctx.contextSnapshot');
    expect(taskSpawn).toContain("session_target: 'isolated'");
    expect(taskSpawn).toContain('contextSnapshot: undefined');
    expect(taskSpawn).toContain('sub_agent.shared.prefix_consistency_failed');

    expect(manager).toContain('validateSharedPrefixConsistency');
    expect(manager).toContain('runtimeSnapshot: this.ctx.contextSnapshot');
    expect(manager).toContain("session_target: 'isolated'");
    expect(manager).toContain('contextSnapshot: undefined');
    expect(manager).toContain('sub_agent.shared.prefix_consistency_failed');
  });
});
