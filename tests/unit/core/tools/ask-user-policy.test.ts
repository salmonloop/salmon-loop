import { describe, expect, it } from 'bun:test';

import { askUserSpec } from '../../../../src/core/tools/builtin/interaction.js';
import { ToolPolicy } from '../../../../src/core/tools/policy.js';
import { Phase } from '../../../../src/core/types/index.js';

describe('interaction.ask_user policy', () => {
  it('denies usage in VERIFY and SHRINK phases', () => {
    const policy = new ToolPolicy();

    const verify = policy.decide(Phase.VERIFY, askUserSpec, { worktreeRoot: '/repo' });
    const shrink = policy.decide(Phase.SHRINK, askUserSpec, { worktreeRoot: '/repo' });

    expect(verify.allowed).toBe(false);
    expect(shrink.allowed).toBe(false);
  });
});
