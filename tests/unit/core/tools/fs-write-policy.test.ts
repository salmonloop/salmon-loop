import { describe, expect, it } from 'bun:test';

import {
  fsCreateDirectorySpec,
  fsDeleteFileSpec,
  fsWriteFileSpec,
} from '../../../../src/core/tools/builtin/fs.js';
import { ToolPolicy } from '../../../../src/core/tools/policy.js';
import { Phase } from '../../../../src/core/types/index.js';

describe('fs write tools policy', () => {
  it('denies write tools in PATCH phase even with worktree isolation', () => {
    const policy = new ToolPolicy();

    const ctx = { worktreeRoot: '/repo' };

    expect(policy.decide(Phase.PATCH, fsWriteFileSpec as any, ctx).allowed).toBe(false);
    expect(policy.decide(Phase.PATCH, fsCreateDirectorySpec as any, ctx).allowed).toBe(false);
    expect(policy.decide(Phase.PATCH, fsDeleteFileSpec as any, ctx).allowed).toBe(false);
  });

  it('allows write tools in SLASH phase with worktree isolation', () => {
    const policy = new ToolPolicy();

    const ctx = { worktreeRoot: '/repo' };

    expect(policy.decide(Phase.SLASH, fsWriteFileSpec as any, ctx).allowed).toBe(true);
    expect(policy.decide(Phase.SLASH, fsCreateDirectorySpec as any, ctx).allowed).toBe(true);
    expect(policy.decide(Phase.SLASH, fsDeleteFileSpec as any, ctx).allowed).toBe(true);
  });

  it('denies write tools in SLASH phase without worktree isolation', () => {
    const policy = new ToolPolicy();

    expect(policy.decide(Phase.SLASH, fsWriteFileSpec as any, {}).allowed).toBe(false);
    expect(policy.decide(Phase.SLASH, fsCreateDirectorySpec as any, {}).allowed).toBe(false);
    expect(policy.decide(Phase.SLASH, fsDeleteFileSpec as any, {}).allowed).toBe(false);
  });

  it('allows write tools in AUTOPILOT phase without worktree isolation', () => {
    const policy = new ToolPolicy();

    const ctx = { flowMode: 'autopilot' };

    expect(policy.decide(Phase.AUTOPILOT, fsWriteFileSpec as any, ctx as any).allowed).toBe(true);
    expect(
      policy.decide(Phase.AUTOPILOT, fsCreateDirectorySpec as any, ctx as any).allowed,
    ).toBe(true);
    expect(policy.decide(Phase.AUTOPILOT, fsDeleteFileSpec as any, ctx as any).allowed).toBe(
      true,
    );
  });
});
