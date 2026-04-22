import { describe, it, expect } from 'bun:test';

import {
  compilePermissionRules,
  decidePermissionForToolCall,
} from '../../../src/core/tools/permissions/permission-rules.js';

const ctx = {
  repoRoot: '/repo',
  attemptId: 1,
  dryRun: false,
} as any;

describe('Permission rules', () => {
  it('keeps Bash alias visibility mapped to shell.exec and test.run', () => {
    const compiled = compilePermissionRules({ allow: ['Bash(git status)'] });
    expect(compiled.ok).toBe(true);
    expect([...compiled.compiled!.visibleToolNamesFromAllow]).toEqual(
      expect.arrayContaining(['shell.exec', 'test.run']),
    );
  });

  it('supports Bash(*) and Bash equivalence (match all)', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(*)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const decision = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'rm -rf /' },
      ctx,
    });
    expect(decision.kind).toBe('allow');
  });

  it('implements trailing " *" word-boundary behavior: "ls *" matches "ls" and "ls -la" but not "lsof"', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(ls *)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const a = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'ls' },
      ctx,
    });
    expect(a.kind).toBe('allow');

    const b = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'ls -la' },
      ctx,
    });
    expect(b.kind).toBe('allow');

    const c = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'lsof' },
      ctx,
    });
    expect(c.kind).toBe('deny');
  });

  it('implements no-boundary behavior: "ls*" matches both "ls -la" and "lsof"', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(ls*)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const a = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'ls -la' },
      ctx,
    });
    expect(a.kind).toBe('allow');

    const b = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'lsof' },
      ctx,
    });
    expect(b.kind).toBe('allow');
  });

  it('supports deprecated ":*" suffix as equivalent to " *"', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(ls:*)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const a = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'ls -la' },
      ctx,
    });
    expect(a.kind).toBe('allow');

    const b = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'lsof' },
      ctx,
    });
    expect(b.kind).toBe('deny');
  });

  it('does not allow shell operator chaining for wildcard Bash rules', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(safe-cmd *)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const ok = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'safe-cmd --arg' },
      ctx,
    });
    expect(ok.kind).toBe('allow');

    const chained = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'safe-cmd --arg && other-cmd' },
      ctx,
    });
    expect(chained.kind).toBe('deny');
  });

  it('allows exact Bash matches containing shell operators when explicitly permitted', async () => {
    const compiled = compilePermissionRules({ allow: ['Bash(safe-cmd && other-cmd)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const decision = await decidePermissionForToolCall({
      rules,
      toolName: 'shell.exec',
      args: { command: 'safe-cmd && other-cmd' },
      ctx,
    });
    expect(decision.kind).toBe('allow');
  });

  it('supports path patterns with "*" and "**" for Read()', async () => {
    const compiled = compilePermissionRules({ allow: ['Read(src/*)'] });
    expect(compiled.ok).toBe(true);
    const rules = compiled.compiled!;

    const ok = await decidePermissionForToolCall({
      rules,
      toolName: 'fs.read',
      args: { file: 'src/a.ts' },
      ctx,
    });
    expect(ok.kind).toBe('allow');

    const deep = await decidePermissionForToolCall({
      rules,
      toolName: 'fs.read',
      args: { file: 'src/dir/a.ts' },
      ctx,
    });
    expect(deep.kind).toBe('deny');

    const compiledDeepRes = compilePermissionRules({ allow: ['Read(src/**)'] });
    expect(compiledDeepRes.ok).toBe(true);
    const compiledDeep = compiledDeepRes.compiled!;
    const deepOk = await decidePermissionForToolCall({
      rules: compiledDeep,
      toolName: 'fs.read',
      args: { file: 'src/dir/a.ts' },
      ctx,
    });
    expect(deepOk.kind).toBe('allow');
  });
});
