import {
  resolveNodeVerifyCommand,
  resolveScriptCommand,
} from '../../../../src/core/target-runtime/command-resolver.js';
import type { NodeRuntimeProfile } from '../../../../src/core/target-runtime/profile.js';

function makeProfile(
  packageManager: NodeRuntimeProfile['packageManager'],
  scripts: Record<string, string>,
): NodeRuntimeProfile {
  return {
    packageManager,
    source: 'default',
    scripts,
  };
}

describe('resolveScriptCommand', () => {
  test('resolves script command for bun', () => {
    const profile = makeProfile('bun', { test: 'vitest run' });
    expect(resolveScriptCommand(profile, 'test')).toEqual({
      packageManager: 'bun',
      scriptName: 'test',
      command: 'bun',
      args: ['run', 'test'],
      shellCommand: 'bun run test',
    });
  });

  test('resolves script command for npm', () => {
    const profile = makeProfile('npm', { lint: 'eslint .' });
    expect(resolveScriptCommand(profile, 'lint')).toEqual({
      packageManager: 'npm',
      scriptName: 'lint',
      command: 'npm',
      args: ['run', 'lint'],
      shellCommand: 'npm run lint',
    });
  });

  test('resolves script command for pnpm', () => {
    const profile = makeProfile('pnpm', { test: 'vitest run' });
    expect(resolveScriptCommand(profile, 'test')).toEqual({
      packageManager: 'pnpm',
      scriptName: 'test',
      command: 'pnpm',
      args: ['run', 'test'],
      shellCommand: 'pnpm run test',
    });
  });

  test('resolves script command for yarn', () => {
    const profile = makeProfile('yarn', { test: 'vitest run' });
    expect(resolveScriptCommand(profile, 'test')).toEqual({
      packageManager: 'yarn',
      scriptName: 'test',
      command: 'yarn',
      args: ['run', 'test'],
      shellCommand: 'yarn run test',
    });
  });

  test('returns undefined for missing script', () => {
    const profile = makeProfile('npm', { lint: 'eslint .' });
    expect(resolveScriptCommand(profile, 'test')).toBeUndefined();
  });
});

describe('resolveNodeVerifyCommand', () => {
  test('returns test command when test script exists', () => {
    const profile = makeProfile('pnpm', { test: 'vitest run' });
    expect(resolveNodeVerifyCommand(profile)).toBe('pnpm run test');
  });

  test('returns undefined when test script is missing', () => {
    const profile = makeProfile('pnpm', { lint: 'eslint .' });
    expect(resolveNodeVerifyCommand(profile)).toBeUndefined();
  });
});
